import http from 'node:http';
import { randomBytes, randomUUID, createHash, randomInt, createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError, createEmailProvider } from './email.js';
import { openStorage, verificationKey } from './storage.js';
import { analyzeWasteImage } from './vision.js';

const root = dirname(fileURLToPath(import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('hex');
export function sameArea(a, b) {
  if (!a || !b) return false;
  const cleanA = a.trim().toLowerCase().replace(/\s+/g, ' ');
  const cleanB = b.trim().toLowerCase().replace(/\s+/g, ' ');
  if (cleanA === cleanB) return true;

  const partsA = cleanA.split(/[,/]/).map(p => p.trim()).filter(Boolean);
  const partsB = cleanB.split(/[,/]/).map(p => p.trim()).filter(Boolean);

  if (partsA.length > 0 && partsB.length > 0) {
    const locA = partsA[0];
    const locB = partsB[0];
    if (locA === locB) return true;
    if (locA.length >= 4 && locB.length >= 4) {
      if (locA.startsWith(locB) || locB.startsWith(locA)) return true;
    }
  }

  const specificA = partsA[0] || cleanA;
  const specificB = partsB[0] || cleanB;
  if (specificA.length >= 4 && specificB.length >= 4) {
    if (specificA.includes(specificB) || specificB.includes(specificA)) return true;
  }

  return false;
}

export function isAllowedOrigin(req, configuredOrigin) {
  const reqOrigin = req.headers.origin;
  if (!reqOrigin) return true;
  if (configuredOrigin && reqOrigin === configuredOrigin) return true;
  if (process.env.APP_ORIGIN && reqOrigin === process.env.APP_ORIGIN.replace(/\/+$/, '')) return true;

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (host) {
    const cleanHost = host.split(':')[0].toLowerCase();
    try {
      const parsed = new URL(reqOrigin);
      const originHost = parsed.host.toLowerCase();
      const originHostname = parsed.hostname.toLowerCase();
      if (originHost === host.toLowerCase() || originHostname === cleanHost) {
        return true;
      }
    } catch {}
  }
  return false;
}

export function validate(input) {
  if (!['generator', 'recycler'].includes(input.role)) throw new AppError(400, 'Choose whether you have or buy recyclable waste.');
  const name = typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : '';
  const area = typeof input.area === 'string' ? input.area.trim().replace(/\s+/g, ' ') : '';
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (name.length < 2 || name.length > 100 || /[\x00-\x1f]/.test(name)) throw new AppError(400, 'Enter your full name (2–100 characters).');
  if (area.length < 2 || area.length > 120 || /[\x00-\x1f]/.test(area)) throw new AppError(400, 'Enter your area or neighbourhood (2–120 characters).');
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email) || email.split('@')[0].length > 64 || email.startsWith('.') || email.includes('..') || email.includes('.@')) throw new AppError(400, 'Enter a valid email address.');
  return { role: input.role, name, area, email };
}

export function createApp({ dbPath = resolve(root, 'data/ecosmart.sqlite'), provider = createEmailProvider(), origin = (process.env.APP_ORIGIN || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'http://localhost:3000')).replace(/\/+$/, ''), demoPayments = process.env.DEMO_PAYMENTS === 'true', secure = process.env.COOKIE_SECURE === 'true', now = Date.now, visionAnalyzer = analyzeWasteImage } = {}) {
  const db = openStorage(dbPath);
  const key = verificationKey(dbPath);
  const codeHash = (id, code) => createHmac('sha256', key).update(`${id}:${code}`).digest('hex');
  const locks = new Set();
  function rate(key, max, window) {
    const row = db.prepare('SELECT * FROM limits WHERE key=?').get(key);
    if (row && row.reset_at > now() && row.count >= max) throw new AppError(429, 'Too many attempts. Please wait and try again.');
    db.prepare('INSERT OR REPLACE INTO limits VALUES (?,?,?)').run(key, row && row.reset_at > now() ? row.count + 1 : 1, row && row.reset_at > now() ? row.reset_at : now() + window);
  }
  async function locked(key, fn) {
    if (locks.has(key)) throw new AppError(409, 'A request is already in progress. Please wait.');
    locks.add(key); try { return await fn(); } finally { locks.delete(key); }
  }
  async function sendCode(id, email) {
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    // Invalidate this issuance before sending, so a failed resend cannot use an old code.
    const sent = now();
    db.prepare("UPDATE registrations SET status='failed',code_hash=NULL,sent_at=? WHERE id=?").run(sent, id);
    const providerId = await provider.send(email, code, randomUUID());
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare("UPDATE registrations SET status='superseded',code_hash=NULL WHERE email=? AND id<>? AND status<>'verified'").run(email, id);
      db.prepare("UPDATE registrations SET provider_id=?,code_hash=?,status='sent',attempts=0,sent_at=?,expires_at=? WHERE id=?").run(providerId, codeHash(id, code), sent, sent + 600000, id);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function cookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').map(x => x.trim().split('='))); }
  function cookie(name, value, age) { return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`; }
  function account(req) {
    const value = cookies(req).eco_session;
    return value ? db.prepare('SELECT u.* FROM users u JOIN sessions s ON u.id=s.user_id WHERE s.id=? AND s.expires_at>?').get(hash(value), now()) : undefined;
  }
  function pending(req) {
    const value = cookies(req).eco_pending;
    const row = value && db.prepare('SELECT * FROM registrations WHERE id=?').get(hash(value));
    if (!row || ['verified', 'superseded'].includes(row.status)) throw new AppError(401, 'Start your registration again.');
    return row;
  }
  function pendingLogin(req) {
    const value = cookies(req).eco_pending_login;
    const row = value && db.prepare('SELECT * FROM login_requests WHERE id=?').get(hash(value));
    if (!row || ['verified', 'superseded'].includes(row.status)) throw new AppError(401, 'Start your sign-in again.');
    return row;
  }
  async function sendLoginCode(id, email) {
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    const sent = now();
    db.prepare("UPDATE login_requests SET status='failed',code_hash=NULL,sent_at=? WHERE id=?").run(sent, id);
    const providerId = await provider.send(email, code, randomUUID());
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare("UPDATE login_requests SET status='superseded',code_hash=NULL WHERE email=? AND id<>? AND status<>'verified'").run(email, id);
      db.prepare("UPDATE login_requests SET provider_id=?,code_hash=?,status='sent',attempts=0,sent_at=?,expires_at=? WHERE id=?").run(providerId, codeHash(id, code), sent, sent + 600000, id);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const publicAccount = row => ({
    id: row.id,
    name: row.name,
    role: row.role,
    email: row.email,
    area: row.area,
    accountStatus: row.account_status,
    nextScreen: row.role === 'administrator'
      ? 'Pilot Administrator Workspace'
      : (row.role === 'generator'
          ? 'Check my waste'
          : (['active', 'approved'].includes(row.account_status)
              ? 'Recycler marketplace dashboard'
              : 'Recycler verification application'))
  });
  async function body(req) {
    if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new AppError(415, 'Send JSON data.');
    let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 5242880) throw new AppError(413, 'Request is too large (maximum 5MB).'); }
    try { const data = JSON.parse(raw); if (!data || Array.isArray(data) || typeof data !== 'object') throw Error(); return data; } catch { throw new AppError(400, 'Invalid request.'); }
  }
  function getOrCreateWallet(userId) {
    const time = now();
    db.prepare('INSERT OR IGNORE INTO user_wallets (id, user_id, available_balance, escrow_locked_balance, currency, created_at, updated_at) VALUES (?, ?, 0, 0, ?, ?, ?)').run(randomUUID(), userId, 'NGN', time, time);
    return db.prepare('SELECT * FROM user_wallets WHERE user_id=?').get(userId);
  }

  const contactsSharedForStatus = status => ['accepted', 'handover arranged', 'inspected', 'funded final offer', 'completed', 'offer rejected', 'expired'].includes(status);
  function redactCounterpartyContacts(listing, user) {
    const shared = contactsSharedForStatus(listing.status);
    if (!shared && user.role === 'recycler') listing.generator_email = null;
    if (!shared && user.role === 'generator') {
      listing.recycler_phone = null;
      listing.recycler_yard_address = null;
    }
    if (user.role !== 'generator' && listing.status === 'accepted') {
      listing.handover_code = null;
    }
    return shared;
  }

  function expireOffer(offerId, time = now()) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const offer = db.prepare('SELECT * FROM final_offers WHERE id=?').get(offerId);
      if (!offer || offer.offer_status !== 'funded and sent' || offer.expires_at > time) {
        db.exec('COMMIT');
        return false;
      }
      const wallet = getOrCreateWallet(offer.recycler_user_id);
      if (wallet.escrow_locked_balance < offer.amount) throw new Error(`Escrow balance mismatch for offer ${offer.id}`);
      const claimed = db.prepare("UPDATE final_offers SET offer_status='expired', decision='expired', decision_at=?, funding_status='returned', updated_at=? WHERE id=? AND offer_status='funded and sent' AND expires_at<=?").run(time, time, offer.id, time);
      if (claimed.changes !== 1) {
        db.exec('COMMIT');
        return false;
      }
      const ref = 'EXPIRE-' + randomBytes(8).toString('hex').toUpperCase();
      db.prepare('UPDATE user_wallets SET available_balance=available_balance+?, escrow_locked_balance=escrow_locked_balance-?, updated_at=? WHERE user_id=?').run(offer.amount, offer.amount, time, offer.recycler_user_id);
      db.prepare("UPDATE listings SET status='expired', updated_at=? WHERE id=? AND status='funded final offer'").run(time, offer.listing_id);
      db.prepare("INSERT INTO wallet_transactions (id,user_id,type,amount,balance_after,listing_id,reference,description,status,created_at) VALUES (?,?,'escrow_unlock',?,?,?,?,'Escrow refunded for expired offer','successful',?)").run(randomUUID(), offer.recycler_user_id, offer.amount, wallet.available_balance + offer.amount, offer.listing_id, ref, time);
      db.prepare("INSERT INTO wallet_payments (id,final_offer_id,listing_id,payer_user_id,payee_user_id,payment_type,amount,commission_amount,currency,provider_name,provider_reference,status,created_at) VALUES (?,?,?,?,?,'funding returned',?,0,'NGN','EcoSmart Escrow',?,'refunded',?)").run(randomUUID(), offer.id, offer.listing_id, offer.recycler_user_id, offer.recycler_user_id, offer.amount, ref, time);
      db.prepare("INSERT INTO transaction_events (id,listing_id,final_offer_id,event_type,actor_user_id,from_status,to_status,event_note,created_at) VALUES (?,?,?,'offer_expired','system','funded final offer','expired','Offer expired after 24 hours. Escrow refunded to recycler.',?)").run(randomUUID(), offer.listing_id, offer.id, time);
      db.exec('COMMIT');
      return true;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  // Reads and the periodic sweep share one idempotent settlement path.
  function expireOffers() {
    const time = now();
    const offers = db.prepare("SELECT id FROM final_offers WHERE offer_status='funded and sent' AND expires_at<=?").all(time);
    for (const offer of offers) {
      try { expireOffer(offer.id, time); }
      catch (error) { console.error('Failed to expire offer safely:', offer.id, error.message); }
    }
  }

  function getBankAccount(userId) {
    return db.prepare('SELECT * FROM user_bank_accounts WHERE user_id=?').get(userId) || null;
  }

  function getUserPayload(user) {
    if (!user) return { materials: [], materialSettings: [], intakes: [], listings: [], incomingRequests: [], wallet: null, bankAccount: null, walletTransactions: [], lifetimeTotal: 0 };
    let recyclerApplication = null;
    let materials = [];
    let materialSettings = [];
    let availability = 'available';
    let generatorIntakes = [];
    let generatorListings = [];
    let incomingRequests = [];
    let wallet = getOrCreateWallet(user.id);
    let bankAccount = getBankAccount(user.id);
    let walletTransactions = db.prepare('SELECT * FROM wallet_transactions WHERE user_id=? ORDER BY created_at DESC LIMIT 25').all(user.id);
    let lifetimeTotal = 0;

    if (user.role === 'recycler') {
      recyclerApplication = db.prepare('SELECT * FROM recycler_applications WHERE user_id=?').get(user.id) || null;
      materials = db.prepare('SELECT * FROM supported_materials WHERE active=1 ORDER BY rowid ASC').all();
      materialSettings = db.prepare('SELECT * FROM recycler_material_settings WHERE user_id=?').all(user.id);
      const availRow = db.prepare('SELECT availability FROM recycler_availability WHERE user_id=?').get(user.id);
      if (availRow) availability = availRow.availability;
      incomingRequests = db.prepare(`
        SELECT 
          l.*, 
          sm.name as material_name, 
          u.name as generator_name, 
          CASE
            WHEN l.status IN ('accepted', 'handover arranged', 'inspected', 'funded final offer', 'completed', 'offer rejected', 'expired') THEN u.email
            ELSE NULL
          END as generator_email,
          u.area as generator_user_area,
          lr.response as response_status,
          lr.decline_reason,
          lr.agreed_arrangement,
          lr.arrangement_note,
          lr.contacts_shared_at,
          lr.created_at as response_created_at
        FROM listings l
        JOIN supported_materials sm ON sm.id = l.material_id
        JOIN users u ON u.id = l.generator_user_id
        LEFT JOIN listing_responses lr ON lr.listing_id = l.id
        WHERE l.recycler_user_id=?
        ORDER BY l.created_at DESC
      `).all(user.id);
      if (incomingRequests) {
        incomingRequests.forEach(req => {
          if (req.status === 'accepted') req.handover_code = null;
        });
      }
      const sumRow = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM wallet_payments WHERE payer_user_id=? AND payment_type='generator payout' AND status='released'").get(user.id);
      lifetimeTotal = sumRow ? sumRow.total : 0;
    } else if (user.role === 'generator') {
      materials = db.prepare('SELECT * FROM supported_materials WHERE active=1 ORDER BY rowid ASC').all();
      generatorIntakes = db.prepare('SELECT * FROM material_intakes WHERE generator_user_id=? ORDER BY created_at DESC LIMIT 5').all(user.id);
      generatorListings = db.prepare(`
        SELECT 
          l.*, 
          sm.name as material_name, 
          COALESCE(ra.business_name, u.name) as recycler_name,
          u.name as recycler_contact_name,
          ra.area as recycler_area,
          CASE 
            WHEN l.status IN ('accepted', 'handover arranged', 'inspected', 'funded final offer', 'completed', 'offer rejected', 'expired') THEN ra.contact_phone 
            ELSE NULL 
          END as recycler_phone,
          CASE 
            WHEN l.status IN ('accepted', 'handover arranged', 'inspected', 'funded final offer', 'completed', 'offer rejected', 'expired') THEN ra.business_address 
            ELSE NULL 
          END as recycler_yard_address,
          lr.response as response_status,
          lr.decline_reason,
          lr.agreed_arrangement,
          lr.arrangement_note,
          lr.contacts_shared_at,
          lr.created_at as response_created_at
        FROM listings l
        JOIN supported_materials sm ON sm.id = l.material_id
        JOIN users u ON u.id = l.recycler_user_id
        LEFT JOIN recycler_applications ra ON ra.user_id = u.id
        LEFT JOIN listing_responses lr ON lr.listing_id = l.id
        WHERE l.generator_user_id=?
        ORDER BY l.created_at DESC
      `).all(user.id);
      const sumRow = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM wallet_payments WHERE payee_user_id=? AND payment_type='generator payout' AND status='released'").get(user.id);
      lifetimeTotal = sumRow ? sumRow.total : 0;
    } else if (user.role === 'administrator') {
      materials = db.prepare('SELECT * FROM supported_materials ORDER BY rowid ASC').all();
    }

    return {
      recyclerApplication,
      materials,
      materialSettings,
      availability,
      intakes: generatorIntakes,
      generatorIntakes,
      listings: generatorListings,
      incomingRequests,
      wallet,
      bankAccount,
      walletTransactions,
      lifetimeTotal
    };
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    try {
      const path = new URL(req.url, origin).pathname;
      if (path.startsWith('/api/admin/')) {
        const user = account(req);
        if (!user) throw new AppError(401, 'Please sign in as an administrator.');
        if (user.role !== 'administrator' || user.account_status !== 'active') throw new AppError(403, 'Administrator access required.');
      }
      if (path.startsWith('/api/')) expireOffers();
      if (req.method === 'GET' && path === '/api/state') {
        const user = account(req);
        let registration;
        try { const p = pending(req); registration = { email: p.email, resendAt: p.sent_at + 60000, expiresAt: p.expires_at }; } catch {}
        let pendingLoginState;
        try { const pl = pendingLogin(req); pendingLoginState = { email: pl.email, resendAt: pl.sent_at + 60000, expiresAt: pl.expires_at }; } catch {}
        const userPayload = getUserPayload(user);
        return json(200, {
          user: user ? publicAccount(user) : null,
          registration: user ? null : registration,
          pendingLogin: user ? null : pendingLoginState,
          ...userPayload,
          emailConfigured: provider.configured, demoPayments, paymentsConfigured: false
        });
      }
      if (req.method === 'GET' && path === '/api/wallet') {
        const user = account(req);
        if (!user) throw new AppError(401, 'Please sign in to view wallet.');
        const wallet = getOrCreateWallet(user.id);
        const bankAccount = getBankAccount(user.id);
        const walletTransactions = db.prepare('SELECT * FROM wallet_transactions WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(user.id);
        
        let lifetimeTotal = 0;
        if (user.role === 'generator') {
          const sumRow = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM wallet_payments WHERE payee_user_id=? AND payment_type='generator payout' AND status='released'").get(user.id);
          lifetimeTotal = sumRow ? sumRow.total : 0;
        } else if (user.role === 'recycler') {
          const sumRow = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM wallet_payments WHERE payer_user_id=? AND payment_type='generator payout' AND status='released'").get(user.id);
          lifetimeTotal = sumRow ? sumRow.total : 0;
        }

        return json(200, { ok: true, wallet, bankAccount, walletTransactions, lifetimeTotal });
      }
      if (req.method === 'GET' && path === '/api/generator/matches') {
        const user = account(req);
        if (!user) throw new AppError(401, 'Please sign in to find matching recyclers.');
        if (user.role !== 'generator') throw new AppError(403, 'Only generators can search for matching recyclers.');
        const materialId = new URL(req.url, origin).searchParams.get('materialId') || '';
        if (!materialId) throw new AppError(400, 'Please specify a material to match.');
        const mat = db.prepare('SELECT * FROM supported_materials WHERE id=? AND active=1').get(materialId);
        if (!mat) throw new AppError(404, 'Material is not in the active pilot catalogue.');

        const rawMatches = db.prepare(`
          SELECT 
            u.id as recycler_id,
            u.name as contact_name,
            COALESCE(ra.business_name, u.name) as business_name,
            COALESCE(ra.area, u.area) as area,
            ra.contact_phone,
            ra.business_address,
            rms.price as estimated_price,
            rms.unit as price_unit,
            COALESCE(rav.availability, 'available') as availability
          FROM users u
          JOIN recycler_applications ra ON ra.user_id = u.id AND ra.status = 'approved'
          JOIN recycler_material_settings rms ON rms.user_id = u.id AND rms.material_id = ? AND rms.accepted = 1
          LEFT JOIN recycler_availability rav ON rav.user_id = u.id
          WHERE u.role = 'recycler'
            AND COALESCE(rav.availability, 'available') = 'available'
          ORDER BY rms.unit, rms.price DESC;
        `).all(materialId);

        const genArea = (user.area || '').toLowerCase();
        const time = now();
        const matches = rawMatches.filter(r => sameArea(user.area, r.area)).map(r => {
          const recArea = (r.area || '').toLowerCase();
          const isExactArea = genArea && (recArea.includes(genArea) || genArea.includes(recArea));
          // Log match snapshot
          db.prepare(`
            INSERT INTO recycler_match_results (id, generator_user_id, recycler_user_id, material_id, estimated_price, price_unit, matched_area, match_status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'shown', ?)
          `).run(randomUUID(), user.id, r.recycler_id, materialId, r.estimated_price, r.price_unit, r.area, time);

          return {
            recyclerId: r.recycler_id,
            businessName: r.business_name,
            contactName: r.contact_name,
            area: r.area,
            estimatedPrice: r.estimated_price,
            priceUnit: r.price_unit,
            availability: r.availability,
            isAreaMatch: isExactArea,
            materialId: mat.id,
            materialName: mat.name
          };
        });

        return json(200, { ok: true, material: mat, matches });
      }
      if (req.method === 'POST' && path.startsWith('/api/')) {
        if (!isAllowedOrigin(req, origin)) throw new AppError(403, 'Request origin is not allowed. Refresh this page and try again.');
        const input = await body(req);
        if (!['/api/chat/messages', '/api/call/status'].includes(path)) {
          rate(`ip:${req.socket.remoteAddress}`, 10000, 3600000);
        }
        if (path === '/api/register') {
          const data = validate(input);
          return await locked(`email:${data.email}`, async () => {
            if (db.prepare('SELECT id FROM users WHERE email=?').get(data.email)) throw new AppError(409, 'This email address already has an account.');
            if (!provider.configured) throw new AppError(503, 'Email verification is not configured yet. Please try again once the service is available.');
            rate(`send:${data.email}`, 5, 3600000);
            const previous = db.prepare('SELECT sent_at FROM registrations WHERE email=? ORDER BY sent_at DESC LIMIT 1').get(data.email);
            if (previous && now() - previous.sent_at < 60000) throw new AppError(429, 'Please wait 60 seconds between email requests.');
            const value = token(); const id = hash(value); const sent = now();
            db.prepare('INSERT INTO registrations (id,role,name,email,area,status,sent_at,expires_at) VALUES (?,?,?,?,?,?,?,?)').run(id, data.role, data.name, data.email, data.area, 'failed', sent, sent + 600000);
            await sendCode(id, data.email);
            res.setHeader('Set-Cookie', cookie('eco_pending', value, 3600));
            return json(200, { email: data.email, resendAt: sent + 60000, expiresAt: sent + 600000 });
          });
        }
        if (path === '/api/resend') {
          const p = pending(req);
          return await locked(`email:${p.email}`, async () => {
            const latest = db.prepare('SELECT sent_at FROM registrations WHERE email=? ORDER BY sent_at DESC LIMIT 1').get(p.email);
            if (latest && now() - latest.sent_at < 60000) throw new AppError(429, 'Please wait 60 seconds between email requests.');
            rate(`send:${p.email}`, 5, 3600000);
            await sendCode(p.id, p.email);
            const sent = db.prepare('SELECT sent_at FROM registrations WHERE id=?').get(p.id).sent_at;
            return json(200, { email: p.email, resendAt: sent + 60000, expiresAt: sent + 600000 });
          });
        }
        if (path === '/api/login/request') {
          const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
          if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email)) throw new AppError(400, 'Enter a valid email address.');
          return await locked(`login:${email}`, async () => {
            const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
            if (!user) throw new AppError(404, 'No account found with this email address. Please create an account first.');
            if (!provider.configured) throw new AppError(503, 'Email service is not configured yet. Please try again later.');
            rate(`send:${email}`, 5, 3600000);
            const previous = db.prepare('SELECT sent_at FROM login_requests WHERE email=? ORDER BY sent_at DESC LIMIT 1').get(email);
            if (previous && now() - previous.sent_at < 60000) throw new AppError(429, 'Please wait 60 seconds between email requests.');
            const value = token(); const id = hash(value); const sent = now();
            db.prepare('INSERT INTO login_requests (id,user_id,email,status,sent_at,expires_at) VALUES (?,?,?,?,?,?)').run(id, user.id, email, 'failed', sent, sent + 600000);
            await sendLoginCode(id, email);
            res.setHeader('Set-Cookie', cookie('eco_pending_login', value, 3600));
            return json(200, { email, resendAt: sent + 60000, expiresAt: sent + 600000 });
          });
        }
        if (path === '/api/login/resend') {
          const pl = pendingLogin(req);
          return await locked(`login:${pl.email}`, async () => {
            const latest = db.prepare('SELECT sent_at FROM login_requests WHERE email=? ORDER BY sent_at DESC LIMIT 1').get(pl.email);
            if (latest && now() - latest.sent_at < 60000) throw new AppError(429, 'Please wait 60 seconds between email requests.');
            rate(`send:${pl.email}`, 5, 3600000);
            await sendLoginCode(pl.id, pl.email);
            const sent = db.prepare('SELECT sent_at FROM login_requests WHERE id=?').get(pl.id).sent_at;
            return json(200, { email: pl.email, resendAt: sent + 60000, expiresAt: sent + 600000 });
          });
        }
        if (path === '/api/login/verify') {
          const pl = pendingLogin(req);
          return await locked(`login:${pl.email}`, async () => {
            if (pl.expires_at <= now()) { db.prepare("UPDATE login_requests SET status='expired',code_hash=NULL WHERE id=?").run(pl.id); throw new AppError(410, 'This code has expired. Request another code.'); }
            if (pl.status !== 'sent' || pl.attempts >= 5) throw new AppError(410, 'Request another code to continue.');
            if (typeof input.code !== 'string' || !/^\d{6}$/.test(input.code)) throw new AppError(400, 'Enter the six-digit code from your email.');
            rate(`check:${pl.email}`, 20, 3600000);
            db.prepare('UPDATE login_requests SET attempts=attempts+1 WHERE id=?').run(pl.id);
            const approved = pl.code_hash && timingSafeEqual(Buffer.from(pl.code_hash, 'hex'), Buffer.from(codeHash(pl.id, input.code), 'hex'));
            if (!approved) throw new AppError(400, 'That code is incorrect. Please try again or request another code.');
            const user = db.prepare('SELECT * FROM users WHERE id=?').get(pl.user_id);
            if (!user) throw new AppError(404, 'User account not found.');
            const session = token(); const time = now();
            db.exec('BEGIN IMMEDIATE');
            try {
              db.prepare("UPDATE login_requests SET status='verified',code_hash=NULL,verified_at=? WHERE id=?").run(time, pl.id);
              db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(session), user.id, time + 604800000);
              db.exec('COMMIT');
            } catch (error) { db.exec('ROLLBACK'); throw error; }
            res.setHeader('Set-Cookie', [cookie('eco_session', session, 604800), cookie('eco_pending_login', '', 0)]);
            const userPayload = getUserPayload(user);
            return json(200, {
              user: publicAccount(user),
              ...userPayload
            });
          });
        }
        if (path === '/api/verify') {
          const p = pending(req);
          return await locked(`email:${p.email}`, async () => {
            if (p.expires_at <= now()) { db.prepare("UPDATE registrations SET status='expired',code_hash=NULL WHERE id=?").run(p.id); throw new AppError(410, 'This code has expired. Request another code.'); }
            if (p.status !== 'sent' || p.attempts >= 5) throw new AppError(410, 'Request another code to continue.');
            if (typeof input.code !== 'string' || !/^\d{6}$/.test(input.code)) throw new AppError(400, 'Enter the six-digit code from your email.');
            rate(`check:${p.email}`, 20, 3600000);
            db.prepare('UPDATE registrations SET attempts=attempts+1 WHERE id=?').run(p.id);
            const approved = p.code_hash && timingSafeEqual(Buffer.from(p.code_hash, 'hex'), Buffer.from(codeHash(p.id, input.code), 'hex'));
            if (!approved) throw new AppError(400, 'That code is incorrect. Please try again or request another code.');
            const id = randomUUID(); const time = now(); const session = token();
            db.exec('BEGIN IMMEDIATE');
            try {
              if (db.prepare('SELECT id FROM users WHERE email=?').get(p.email)) throw new AppError(409, 'This email address already has an account.');
              db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?)').run(id, p.role, p.name, p.email, p.area, 'verified', p.role === 'recycler' ? 'pending recycler approval' : 'active', time, time);
              db.prepare("UPDATE registrations SET status='verified',code_hash=NULL,verified_at=?,user_id=? WHERE id=?").run(time, id, p.id);
              db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(session), id, time + 604800000);
              db.exec('COMMIT');
            } catch (error) { db.exec('ROLLBACK'); throw error; }
            res.setHeader('Set-Cookie', [cookie('eco_session', session, 604800), cookie('eco_pending', '', 0)]);
            const newUser = db.prepare('SELECT * FROM users WHERE id=?').get(id);
            const userPayload = getUserPayload(newUser);
            return json(200, { user: publicAccount(newUser), ...userPayload });
          });
        }
        if (path === '/api/wallet') {
          const user = account(req);
          if (!user) throw new AppError(401, 'Please sign in to view wallet.');
          const wallet = getOrCreateWallet(user.id);
          const bankAccount = getBankAccount(user.id);
          const walletTransactions = db.prepare('SELECT * FROM wallet_transactions WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(user.id);
          
          let lifetimeTotal = 0;
          if (user.role === 'generator') {
            const sumRow = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM wallet_payments WHERE payee_user_id=? AND payment_type='generator payout' AND status='released'").get(user.id);
            lifetimeTotal = sumRow ? sumRow.total : 0;
          } else if (user.role === 'recycler') {
            const sumRow = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM wallet_payments WHERE payer_user_id=? AND payment_type='generator payout' AND status='released'").get(user.id);
            lifetimeTotal = sumRow ? sumRow.total : 0;
          }

          return json(200, { ok: true, wallet, bankAccount, walletTransactions, lifetimeTotal });
        }
        if (path === '/api/wallet/topup') {
          if (!demoPayments) throw new AppError(503, 'Payments are unavailable. No payment provider is connected.');
          const user = account(req);
          if (!user) throw new AppError(401, 'Please sign in to top up wallet.');
          const amount = Number(input.amount);
          if (!amount || isNaN(amount) || amount < 100 || amount > 5000000) {
            throw new AppError(400, 'Enter a valid top-up amount between ₦100 and ₦5,000,000.');
          }
          const channel = 'demo_credit';
          const time = now();
          const ref = 'TOPUP-' + randomBytes(4).toString('hex').toUpperCase();

          db.exec('BEGIN IMMEDIATE');
          try {
            getOrCreateWallet(user.id);
            db.prepare('UPDATE user_wallets SET available_balance = available_balance + ?, updated_at = ? WHERE user_id = ?').run(amount, time, user.id);
            const updatedWallet = db.prepare('SELECT * FROM user_wallets WHERE user_id=?').get(user.id);
            
            db.prepare(`
              INSERT INTO wallet_transactions (id, user_id, type, amount, balance_after, reference, description, metadata, status, created_at)
              VALUES (?, ?, 'topup', ?, ?, ?, ?, ?, 'successful', ?)
            `).run(randomUUID(), user.id, amount, updatedWallet.available_balance, ref, 'Demo wallet credit (no payment collected)', JSON.stringify({ channel }), time);

            db.exec('COMMIT');
          } catch (err) {
            db.exec('ROLLBACK');
            throw err;
          }

          const wallet = db.prepare('SELECT * FROM user_wallets WHERE user_id=?').get(user.id);
          const walletTransactions = db.prepare('SELECT * FROM wallet_transactions WHERE user_id=? ORDER BY created_at DESC LIMIT 25').all(user.id);
          return json(200, { ok: true, wallet, walletTransactions, reference: ref });
        }
        if (path === '/api/wallet/bank-account') {
          const user = account(req);
          if (!user) throw new AppError(401, 'Please sign in to link bank account.');
          const bankCode = typeof input.bankCode === 'string' ? input.bankCode.trim() : '';
          const bankName = typeof input.bankName === 'string' ? input.bankName.trim() : '';
          const accountNumber = typeof input.accountNumber === 'string' ? input.accountNumber.trim().replace(/\D/g, '') : '';
          let accountName = typeof input.accountName === 'string' ? input.accountName.trim() : '';

          if (!bankName || bankName.length < 2) throw new AppError(400, 'Please select your bank.');
          if (!accountNumber || accountNumber.length !== 10) throw new AppError(400, 'Enter a valid 10-digit NUBAN account number.');
          if (!accountName) {
            accountName = user.name.toUpperCase();
          }

          const time = now();
          const existing = db.prepare('SELECT * FROM user_bank_accounts WHERE user_id=?').get(user.id);
          const bankAcctId = existing ? existing.id : randomUUID();

          db.prepare(`
            INSERT OR REPLACE INTO user_bank_accounts (id, user_id, bank_code, bank_name, account_number, account_name, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(bankAcctId, user.id, bankCode, bankName, accountNumber, accountName, existing ? existing.created_at : time, time);

          const bankAccount = db.prepare('SELECT * FROM user_bank_accounts WHERE user_id=?').get(user.id);
          return json(200, { ok: true, bankAccount });
        }
        if (path === '/api/wallet/withdraw') {
          if (!demoPayments) throw new AppError(503, 'Payments are unavailable. No payment provider is connected.');
          const user = account(req);
          if (!user) throw new AppError(401, 'Please sign in to withdraw funds.');
          const amount = Number(input.amount);
          if (!amount || isNaN(amount) || amount < 500) {
            throw new AppError(400, 'Minimum withdrawal amount is ₦500.');
          }

          const wallet = getOrCreateWallet(user.id);
          if (wallet.available_balance < amount) {
            throw new AppError(400, `Insufficient available balance. You have ₦${wallet.available_balance.toLocaleString()} available.`);
          }

          const bankAccount = getBankAccount(user.id);
          if (!bankAccount) {
            throw new AppError(400, 'Please save your Nigerian bank account details first.');
          }

          const time = now();
          const ref = 'WTH-' + randomBytes(4).toString('hex').toUpperCase();

          db.exec('BEGIN IMMEDIATE');
          try {
            const withdrawn = db.prepare('UPDATE user_wallets SET available_balance = available_balance - ?, updated_at = ? WHERE user_id = ? AND available_balance >= ?').run(amount, time, user.id, amount);
            if (withdrawn.changes !== 1) throw new AppError(409, 'Wallet balance changed before this withdrawal completed. Refresh and try again.');
            const updatedWallet = db.prepare('SELECT * FROM user_wallets WHERE user_id=?').get(user.id);

            db.prepare(`
              INSERT INTO wallet_transactions (id, user_id, type, amount, balance_after, reference, description, metadata, status, created_at)
              VALUES (?, ?, 'withdrawal', ?, ?, ?, ?, ?, 'successful', ?)
            `).run(randomUUID(), user.id, -amount, updatedWallet.available_balance, ref, `Demo withdrawal to ${bankAccount.bank_name} (${bankAccount.account_number}); no transfer sent`, JSON.stringify({ bank: bankAccount.bank_name, account: bankAccount.account_number, recipientName: bankAccount.account_name }), time);

            db.exec('COMMIT');
          } catch (err) {
            db.exec('ROLLBACK');
            throw err;
          }

          const freshWallet = db.prepare('SELECT * FROM user_wallets WHERE user_id=?').get(user.id);
          const walletTransactions = db.prepare('SELECT * FROM wallet_transactions WHERE user_id=? ORDER BY created_at DESC LIMIT 25').all(user.id);
          return json(200, { ok: true, wallet: freshWallet, walletTransactions, reference: ref, bankAccount });
        }
        if (path === '/api/generator/intake') {
          const user = account(req);
          if (!user) throw new AppError(401, 'Please sign in to check your recyclable waste.');
          if (user.role !== 'generator') throw new AppError(403, 'Only generators can check recyclable waste.');
          const materialId = typeof input.materialId === 'string' ? input.materialId.trim() : '';
          const materialName = typeof input.materialName === 'string' && input.materialName.trim() ? input.materialName.trim() : '';
          const intakeMethod = ['manual selection', 'photo upload', 'scan'].includes(input.intakeMethod) ? input.intakeMethod : 'manual selection';
          const photoFile = typeof input.photoFile === 'string' && input.photoFile.trim() ? input.photoFile.trim() : null;
          const unsupportedName = typeof input.unsupportedName === 'string' ? input.unsupportedName.trim() : '';
          const time = now();
          const intakeId = randomUUID();

          const mat = materialId && materialId !== 'unsupported' ? db.prepare('SELECT * FROM supported_materials WHERE id=? AND active=1').get(materialId) : null;
          if (mat) {
            db.prepare(`
              INSERT INTO material_intakes (id, generator_user_id, intake_method, material_id, material_name, photo_file, recyclable, guidance_tip, outcome, created_at)
              VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'continued to matching', ?)
            `).run(intakeId, user.id, intakeMethod, mat.id, mat.name, photoFile, mat.guidance, time);

            const record = db.prepare('SELECT * FROM material_intakes WHERE id=?').get(intakeId);
            const intakes = db.prepare('SELECT * FROM material_intakes WHERE generator_user_id=? ORDER BY created_at DESC LIMIT 10').all(user.id);
            return json(200, { ok: true, supported: true, material: mat, intake: record, intakes });
          } else {
            const name = materialName || unsupportedName || (materialId && materialId !== 'unsupported' ? `Unsupported (${materialId})` : 'Other / Non-pilot Material');
            const guidance = typeof input.guidanceTip === 'string' && input.guidanceTip.trim() ? input.guidanceTip.trim() : 'This item is not supported in the pilot catalogue. EcoSmart currently supports: cardboard, PET plastic bottles, aluminium, brass, and glass.';
            db.prepare(`
              INSERT INTO material_intakes (id, generator_user_id, intake_method, material_id, material_name, photo_file, recyclable, guidance_tip, outcome, created_at)
              VALUES (?, ?, ?, NULL, ?, ?, 0, ?, 'not supported in this pilot', ?)
            `).run(intakeId, user.id, intakeMethod, name, photoFile, guidance, time);

            const record = db.prepare('SELECT * FROM material_intakes WHERE id=?').get(intakeId);
            const intakes = db.prepare('SELECT * FROM material_intakes WHERE generator_user_id=? ORDER BY created_at DESC LIMIT 10').all(user.id);
            return json(200, { ok: true, supported: false, guidance, intake: record, intakes });
          }
        }
        if (path === '/api/generator/intake-analyze') {
          const user = account(req);
          if (!user) throw new AppError(401, 'Please sign in to analyze recyclable waste.');
          if (user.role !== 'generator') throw new AppError(403, 'Only generators can analyze recyclable waste.');
          
          const photoFile = input.photoFile || input.file || null;
          const analysis = await visionAnalyzer({ photoFile });
          return json(200, analysis);
        }
        if (path === '/api/generator/matches') {
          const user = account(req);
          if (!user) throw new AppError(401, 'Please sign in to find matching recyclers.');
          if (user.role !== 'generator') throw new AppError(403, 'Only generators can search for matching recyclers.');
          const materialId = typeof input.materialId === 'string' ? input.materialId.trim() : '';
          if (!materialId) throw new AppError(400, 'Please specify a material to match.');
          const mat = db.prepare('SELECT * FROM supported_materials WHERE id=? AND active=1').get(materialId);
          if (!mat) throw new AppError(404, 'Material is not in the active pilot catalogue.');

          const rawMatches = db.prepare(`
            SELECT 
              u.id as recycler_id,
              u.name as contact_name,
              COALESCE(ra.business_name, u.name) as business_name,
              COALESCE(ra.area, u.area) as area,
              ra.contact_phone,
              ra.business_address,
              rms.price as estimated_price,
              rms.unit as price_unit,
              COALESCE(rav.availability, 'available') as availability
            FROM users u
            JOIN recycler_applications ra ON ra.user_id = u.id AND ra.status = 'approved'
            JOIN recycler_material_settings rms ON rms.user_id = u.id AND rms.material_id = ? AND rms.accepted = 1
            LEFT JOIN recycler_availability rav ON rav.user_id = u.id
            WHERE u.role = 'recycler'
              AND COALESCE(rav.availability, 'available') = 'available'
            ORDER BY rms.unit, rms.price DESC;
          `).all(materialId);

          const genArea = (user.area || '').toLowerCase();
          const time = now();
          const matches = rawMatches.filter(r => sameArea(user.area, r.area)).map(r => {
            const recArea = (r.area || '').toLowerCase();
            const isExactArea = genArea && (recArea.includes(genArea) || genArea.includes(recArea));
            db.prepare(`
              INSERT INTO recycler_match_results (id, generator_user_id, recycler_user_id, material_id, estimated_price, price_unit, matched_area, match_status, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'shown', ?)
            `).run(randomUUID(), user.id, r.recycler_id, materialId, r.estimated_price, r.price_unit, r.area, time);

            return {
              recyclerId: r.recycler_id,
              businessName: r.business_name,
              contactName: r.contact_name,
              area: r.area,
              estimatedPrice: r.estimated_price,
              priceUnit: r.price_unit,
              availability: r.availability,
              isAreaMatch: isExactArea,
              materialId: mat.id,
              materialName: mat.name
            };
          });

          return json(200, { ok: true, material: mat, matches });
        }
        if (path === '/api/generator/listings') {
          const user = account(req);
          if (!user) throw new AppError(401, 'Please sign in to send a listing.');
          if (user.role !== 'generator') throw new AppError(403, 'Only generators can create waste listings.');

          const recyclerId = typeof input.recyclerId === 'string' ? input.recyclerId.trim() : '';
          const materialId = typeof input.materialId === 'string' ? input.materialId.trim() : '';
          const materialIntakeId = typeof input.materialIntakeId === 'string' && input.materialIntakeId.trim() ? input.materialIntakeId.trim() : null;
          const description = typeof input.description === 'string' ? input.description.trim().replace(/\s+/g, ' ') : '';
          const photoFile = typeof input.photoFile === 'string' ? input.photoFile.trim() : null;
          const declaredQuantity = typeof input.declaredQuantity === 'number' ? input.declaredQuantity : (input.declaredQuantity ? Number(input.declaredQuantity) : null);
          const quantityUnit = typeof input.quantityUnit === 'string' ? input.quantityUnit.trim() : 'kg';
          const locationAddress = typeof input.locationAddress === 'string' && input.locationAddress.trim() ? input.locationAddress.trim() : (user.area || '');
          const preferredArrangement = ['pickup', 'drop-off'].includes(input.preferredArrangement) ? input.preferredArrangement : 'pickup';

          if (!recyclerId) throw new AppError(400, 'Please select a verified recycler.');
          if (!materialId) throw new AppError(400, 'Please select a supported material.');
          if (description.length > 300) throw new AppError(400, 'Waste description must be 300 characters or fewer.');
          if (declaredQuantity !== null && (!Number.isFinite(declaredQuantity) || declaredQuantity <= 0)) throw new AppError(400, 'Quantity must be a positive number.');
          if (!['kg', 'items', 'bags'].includes(quantityUnit)) throw new AppError(400, 'Quantity unit must be kg, items, or bags.');
          if (!locationAddress || locationAddress.length < 2) throw new AppError(400, 'Please provide your location or pickup/drop-off address.');
          if (locationAddress.length > 200) throw new AppError(400, 'Location address must be 200 characters or fewer.');

          if (materialIntakeId) {
            const intake = db.prepare('SELECT material_id FROM material_intakes WHERE id=? AND generator_user_id=?').get(materialIntakeId, user.id);
            if (!intake || intake.material_id !== materialId) throw new AppError(400, 'The selected material check does not belong to this listing.');
          }

          const recycler = db.prepare(`
            SELECT u.id, u.name, ra.business_name, ra.area, ra.status as app_status, COALESCE(rav.availability, 'available') as availability
            FROM users u
            JOIN recycler_applications ra ON ra.user_id = u.id
            LEFT JOIN recycler_availability rav ON rav.user_id = u.id
            WHERE u.id=? AND u.role='recycler'
          `).get(recyclerId);

          if (!recycler || recycler.app_status !== 'approved') {
            throw new AppError(400, 'The selected recycler is not verified or approved.');
          }

          const setting = db.prepare(`
            SELECT * FROM recycler_material_settings WHERE user_id=? AND material_id=? AND accepted=1
          `).get(recyclerId, materialId);

          const material = db.prepare('SELECT id FROM supported_materials WHERE id=? AND active=1 AND recyclable=1').get(materialId);
          if (!material || !setting || recycler.availability !== 'available' || !sameArea(user.area, recycler.area)) {
            throw new AppError(400, 'This recycler is no longer available for this material in your area. Refresh your matches.');
          }
          const estimatedPrice = setting.price;
          const priceUnit = setting ? setting.unit : 'per kilogram';

          const time = now();
          const listingId = randomUUID();

          db.exec('BEGIN IMMEDIATE');
          try {
            db.prepare(`
              INSERT INTO listings (
                id, generator_user_id, recycler_user_id, material_id, material_intake_id,
                description, photo_file, declared_quantity, quantity_unit, location_address,
                generator_area, preferred_arrangement, estimated_price, price_unit, status,
                created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent to recycler', ?, ?)
            `).run(
              listingId, user.id, recyclerId, materialId, materialIntakeId,
              description, photoFile, declaredQuantity, quantityUnit, locationAddress,
              user.area, preferredArrangement, estimatedPrice, priceUnit,
              time, time
            );

            db.prepare(`
              INSERT INTO recycler_match_results (id, generator_user_id, recycler_user_id, material_id, estimated_price, price_unit, matched_area, match_status, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'selected', ?)
            `).run(randomUUID(), user.id, recyclerId, materialId, estimatedPrice, priceUnit, recycler.area, time);

            db.prepare(`
              INSERT INTO transaction_events (id, listing_id, final_offer_id, event_type, actor_user_id, from_status, to_status, event_note, created_at)
              VALUES (?, ?, NULL, 'listing_created', ?, 'draft', 'sent to recycler', 'Generator created direct listing for single verified buyer.', ?)
            `).run(randomUUID(), listingId, user.id, time);

            db.exec('COMMIT');
          } catch (err) {
            db.exec('ROLLBACK');
            throw err;
          }

          const newListing = db.prepare(`
            SELECT l.*, sm.name as material_name, COALESCE(ra.business_name, u.name) as recycler_name
            FROM listings l
            JOIN supported_materials sm ON sm.id = l.material_id
            JOIN users u ON u.id = l.recycler_user_id
            LEFT JOIN recycler_applications ra ON ra.user_id = u.id
            WHERE l.id=?
          `).get(listingId);

          const allListings = db.prepare(`
            SELECT l.*, sm.name as material_name, COALESCE(ra.business_name, u.name) as recycler_name
            FROM listings l
            JOIN supported_materials sm ON sm.id = l.material_id
            JOIN users u ON u.id = l.recycler_user_id
            LEFT JOIN recycler_applications ra ON ra.user_id = u.id
            WHERE l.generator_user_id=?
            ORDER BY l.created_at DESC
          `).all(user.id);

          return json(200, { ok: true, listing: newListing, listings: allListings });
        }
        if (path === '/api/recycler/listings/respond') {
          const user = account(req);
          if (!user || user.role !== 'recycler') throw new AppError(401, 'Please sign in as a recycler to respond to listings.');
          const listingId = typeof input.listingId === 'string' ? input.listingId.trim() : '';
          const decision = input.decision;
          if (!listingId) throw new AppError(400, 'Listing ID is required.');
          if (!['accepted', 'declined'].includes(decision)) throw new AppError(400, 'Decision must be accepted or declined.');

          const listing = db.prepare('SELECT * FROM listings WHERE id=?').get(listingId);
          if (!listing) throw new AppError(404, 'Listing not found.');
          if (listing.recycler_user_id !== user.id) throw new AppError(403, 'You are not the designated recipient of this listing.');
          if (listing.status !== 'sent to recycler') throw new AppError(400, `This listing has already been ${listing.status}.`);

          const time = now();
          const responseId = randomUUID();
          let eventNote = '';

          db.exec('BEGIN IMMEDIATE');
          try {
            let handoverCode = null;
            if (decision === 'accepted') {
              handoverCode = String(randomInt(1000, 10000));
            }
            const claimed = db.prepare("UPDATE listings SET status=?, handover_code=?, updated_at=? WHERE id=? AND status='sent to recycler'").run(decision, handoverCode, time, listingId);
            if (claimed.changes !== 1) throw new AppError(409, 'This listing was already answered. Refresh to see its current status.');
            if (decision === 'accepted') {
              const agreedArrangement = ['pickup', 'drop-off'].includes(input.agreedArrangement) ? input.agreedArrangement : (listing.preferred_arrangement || 'pickup');
              const arrangementNote = typeof input.arrangementNote === 'string' ? input.arrangementNote.trim().replace(/\s+/g, ' ') : '';
              if (arrangementNote.length > 300) throw new AppError(400, 'Arrangement notes must be 300 characters or fewer.');
              eventNote = `Recycler accepted request with ${agreedArrangement}`;
              
              db.prepare(`
                INSERT OR REPLACE INTO listing_responses (id, listing_id, recycler_user_id, response, decline_reason, agreed_arrangement, arrangement_note, contacts_shared_at, created_at)
                VALUES (?, ?, ?, 'accepted', NULL, ?, ?, ?, ?)
              `).run(responseId, listingId, user.id, agreedArrangement, arrangementNote, time, time);
            } else {
              const declineReason = typeof input.declineReason === 'string' ? input.declineReason.trim().replace(/\s+/g, ' ') : 'Recycler currently unable to accept this request';
              if (declineReason.length > 300) throw new AppError(400, 'Decline reasons must be 300 characters or fewer.');
              eventNote = `Recycler declined listing: ${declineReason}`;
              
              db.prepare(`
                INSERT OR REPLACE INTO listing_responses (id, listing_id, recycler_user_id, response, decline_reason, agreed_arrangement, arrangement_note, contacts_shared_at, created_at)
                VALUES (?, ?, ?, 'declined', ?, NULL, NULL, NULL, ?)
              `).run(responseId, listingId, user.id, declineReason, time);
            }
            db.prepare(`
              INSERT INTO transaction_events (id, listing_id, final_offer_id, event_type, actor_user_id, from_status, to_status, event_note, created_at)
              VALUES (?, ?, NULL, ?, ?, 'sent to recycler', ?, ?, ?)
            `).run(randomUUID(), listingId, decision === 'accepted' ? 'response_accepted' : 'response_declined', user.id, decision, eventNote, time);
            db.exec('COMMIT');
          } catch (err) {
            db.exec('ROLLBACK');
            throw err;
          }

          const updatedListing = db.prepare(`
            SELECT l.*, sm.name as material_name, COALESCE(ra.business_name, u.name) as recycler_name,
                   ra.contact_phone as recycler_phone, ra.business_address as recycler_yard_address,
                   gu.name as generator_name, gu.email as generator_email, gu.area as generator_area
            FROM listings l
            JOIN supported_materials sm ON sm.id = l.material_id
            JOIN users u ON u.id = l.recycler_user_id
            LEFT JOIN recycler_applications ra ON ra.user_id = u.id
            JOIN users gu ON gu.id = l.generator_user_id
            WHERE l.id=?
          `).get(listingId);

          const responseRecord = db.prepare('SELECT * FROM listing_responses WHERE listing_id=?').get(listingId);

          if (provider && typeof provider.sendNotification === 'function') {
            if (decision === 'accepted') {
              const recName = updatedListing.recycler_name || 'Verified Recycler';
              const subject = `EcoSmart · Listing Accepted & Handover Arranged by ${recName}`;
              const text = `Hello ${updatedListing.generator_name},\n\nGreat news! ${recName} has accepted your recyclable waste listing for ${updatedListing.material_name || 'recyclable materials'}.\n\nHandover Arrangement: ${responseRecord?.agreed_arrangement === 'pickup' ? '🚚 Recycler Pickup' : '📍 Generator Drop-off'}\nCoordination Note: ${responseRecord?.arrangement_note || 'Direct contact details have been unlocked.'}\n\nPlease visit EcoSmart at ${origin} to view their verified contact phone number, yard address, and coordinate the exchange.\n\nThank you for recycling with EcoSmart!`;
              provider.sendNotification(updatedListing.generator_email, subject, text).catch(() => {});
            } else {
              const recName = updatedListing.recycler_name || 'Verified Recycler';
              const subject = `EcoSmart · Update on your recyclable waste listing`;
              const text = `Hello ${updatedListing.generator_name},\n\n${recName} was unable to accept your recyclable waste listing for ${updatedListing.material_name || 'recyclables'}.\nReason: ${responseRecord?.decline_reason || 'Recycler currently at capacity'}\n\nPlease visit EcoSmart at ${origin} to choose another verified buyer in your area.`;
              provider.sendNotification(updatedListing.generator_email, subject, text).catch(() => {});
            }
          }

          redactCounterpartyContacts(updatedListing, user);

          return json(200, { ok: true, listing: updatedListing, response: responseRecord });
        }
        if (path === '/api/recycler/listings/handover-complete') {
          const user = account(req);
          if (!user || user.role !== 'recycler') throw new AppError(401, 'Please sign in as a recycler.');
          const listingId = typeof input.listingId === 'string' ? input.listingId.trim() : '';
          if (!listingId) throw new AppError(400, 'Listing ID is required.');

          const listing = db.prepare('SELECT * FROM listings WHERE id=?').get(listingId);
          if (!listing) throw new AppError(404, 'Listing not found.');
          if (listing.recycler_user_id !== user.id) throw new AppError(403, 'You are not the designated recipient of this listing.');
          if (listing.status !== 'accepted') throw new AppError(400, 'Listing must be accepted before marking handover complete.');

          if (listing.handover_code && (input.handoverCode !== undefined || input.handover_code !== undefined)) {
            const enteredCode = String(input.handoverCode || input.handover_code || '').trim();
            if (!enteredCode || enteredCode !== listing.handover_code) {
              throw new AppError(400, 'Invalid handover confirmation code. Please enter the 4-digit code provided by the generator.');
            }
          }

          const time = now();
          db.exec('BEGIN IMMEDIATE');
          try {
            const claimed = db.prepare("UPDATE listings SET status='handover arranged', updated_at=? WHERE id=? AND status='accepted'").run(time, listingId);
            if (claimed.changes !== 1) throw new AppError(409, 'This handover was already updated. Refresh to see its current status.');
            db.prepare(`
              INSERT INTO transaction_events (id, listing_id, final_offer_id, event_type, actor_user_id, from_status, to_status, event_note, created_at)
              VALUES (?, ?, NULL, 'handover_completed', ?, 'accepted', 'handover arranged', 'Physical handover completed / coordinated for inspection.', ?)
            `).run(randomUUID(), listingId, user.id, time);
            db.exec('COMMIT');
          } catch (err) { db.exec('ROLLBACK'); throw err; }

          const updatedListing = db.prepare('SELECT * FROM listings WHERE id=?').get(listingId);
          return json(200, { ok: true, listing: updatedListing });
        }
        if (path === '/api/recycler/inspection/submit-offer') {
          if (!demoPayments) throw new AppError(503, 'Payments are unavailable. No payment provider is connected.');
          const user = account(req);
          if (!user || user.role !== 'recycler') throw new AppError(401, 'Please sign in as a recycler.');
          const listingId = typeof input.listingId === 'string' ? input.listingId.trim() : '';
          const actualQuantity = typeof input.actualQuantity === 'number' ? input.actualQuantity : Number(input.actualQuantity);
          const actualUnit = typeof input.actualUnit === 'string' && input.actualUnit.trim() ? input.actualUnit.trim() : 'kg';
          const inspectionNote = typeof input.inspectionNotes === 'string' ? input.inspectionNotes.trim() : (typeof input.inspectionNote === 'string' ? input.inspectionNote.trim() : '');
          const amount = typeof input.amount === 'number' ? input.amount : Number(input.amount);

          if (!listingId) throw new AppError(400, 'Listing ID is required.');
          if (!Number.isFinite(actualQuantity) || actualQuantity <= 0) throw new AppError(400, 'Enter a valid actual measured weight / quantity greater than 0.');
          if (!['kg', 'items', 'bags'].includes(actualUnit)) throw new AppError(400, 'Measurement unit must be kg, items, or bags.');
          if (inspectionNote.length > 300) throw new AppError(400, 'Inspection notes must be 300 characters or fewer.');
          if (!Number.isFinite(amount) || amount <= 0 || amount > 5000000) throw new AppError(400, 'Enter a funded offer amount between ₦0.01 and ₦5,000,000.');

          const listing = db.prepare(`
            SELECT l.*, sm.name as material_name, gu.email as generator_email, gu.name as generator_name,
                   COALESCE(ra.business_name, ru.name) as recycler_name
            FROM listings l
            JOIN supported_materials sm ON sm.id = l.material_id
            JOIN users gu ON gu.id = l.generator_user_id
            JOIN users ru ON ru.id = l.recycler_user_id
            LEFT JOIN recycler_applications ra ON ra.user_id = ru.id
            WHERE l.id=?
          `).get(listingId);

          if (!listing) throw new AppError(404, 'Listing not found.');
          if (listing.recycler_user_id !== user.id) throw new AppError(403, 'You are not the designated recycler for this listing.');
          if (!['accepted', 'handover arranged'].includes(listing.status)) {
            throw new AppError(400, `Cannot submit offer on a listing with status '${listing.status}'.`);
          }
          if (listing.status === 'accepted' && listing.handover_code && (input.handoverCode !== undefined || input.handover_code !== undefined)) {
            const enteredCode = String(input.handoverCode || input.handover_code || '').trim();
            if (!enteredCode || enteredCode !== listing.handover_code) {
              throw new AppError(400, 'Invalid handover confirmation code. Please verify handover with the generator before recording inspection.');
            }
          }

          const time = now();
          const inspectionId = randomUUID();
          const finalOfferId = randomUUID();
          const paymentId = randomUUID();
          const providerRef = 'ESCROW-' + randomBytes(4).toString('hex').toUpperCase();
          const expiresAt = time + (24 * 60 * 60 * 1000); // 24 hours expiry window

          db.exec('BEGIN IMMEDIATE');
          try {
            const claimed = db.prepare("UPDATE listings SET status='inspected', updated_at=? WHERE id=? AND status IN ('accepted','handover arranged')").run(time, listingId);
            if (claimed.changes !== 1) throw new AppError(409, 'This listing already has an inspection or final offer. Refresh to see its current status.');
            const recWallet = getOrCreateWallet(user.id);
            if (recWallet.available_balance < amount) throw new AppError(400, 'Insufficient available balance. Top up your wallet before sending an offer.');

            db.prepare(`
              INSERT INTO inspections (id, listing_id, recycler_user_id, actual_quantity, actual_unit, inspection_note, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(inspectionId, listingId, user.id, actualQuantity, actualUnit, inspectionNote, time);

            db.prepare(`
              INSERT INTO final_offers (id, listing_id, recycler_user_id, generator_user_id, inspection_id, amount, currency, funding_status, offer_status, sent_at, expires_at, decision, decision_at, rejection_reason, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, 'NGN', 'funded', 'funded and sent', ?, ?, 'pending', NULL, NULL, ?, ?)
            `).run(finalOfferId, listingId, user.id, listing.generator_user_id, inspectionId, amount, time, expiresAt, time, time);

            db.prepare(`
              INSERT INTO wallet_payments (id, final_offer_id, listing_id, payer_user_id, payee_user_id, payment_type, amount, commission_amount, currency, provider_name, provider_reference, status, created_at)
              VALUES (?, ?, ?, ?, NULL, 'recycler funding', ?, 0, 'NGN', 'EcoSmart Escrow', ?, 'successful', ?)
            `).run(paymentId, finalOfferId, listingId, user.id, amount, providerRef, time);

            db.prepare('UPDATE user_wallets SET available_balance = available_balance - ?, escrow_locked_balance = escrow_locked_balance + ?, updated_at = ? WHERE user_id = ?').run(amount, amount, time, user.id);
            const afterWallet = db.prepare('SELECT * FROM user_wallets WHERE user_id=?').get(user.id);

            db.prepare(`
              INSERT INTO wallet_transactions (id, user_id, type, amount, balance_after, listing_id, reference, description, status, created_at)
              VALUES (?, ?, 'escrow_lock', ?, ?, ?, ?, ?, 'successful', ?)
            `).run(randomUUID(), user.id, -amount, afterWallet.available_balance, listingId, providerRef, `Escrow locked for ${listing.material_name} final offer`, time);

            db.prepare("UPDATE listings SET status='funded final offer', updated_at=? WHERE id=?").run(time, listingId);

            db.prepare(`
              INSERT INTO transaction_events (id, listing_id, final_offer_id, event_type, actor_user_id, from_status, to_status, event_note, created_at)
              VALUES (?, ?, ?, 'inspection_recorded', ?, ?, 'inspected', ?, ?)
            `).run(randomUUID(), listingId, finalOfferId, user.id, listing.status, `Inspection recorded: ${actualQuantity} ${actualUnit}. Notes: ${inspectionNote || 'None'}`, time);

            db.prepare(`
              INSERT INTO transaction_events (id, listing_id, final_offer_id, event_type, actor_user_id, from_status, to_status, event_note, created_at)
              VALUES (?, ?, ?, 'offer_funded_and_sent', ?, 'inspected', 'funded final offer', ?, ?)
            `).run(randomUUID(), listingId, finalOfferId, user.id, `Final offer of ₦${amount} funded into escrow and sent. 24h window active.`, time);

            db.exec('COMMIT');
          } catch (err) {
            db.exec('ROLLBACK');
            throw err;
          }

          if (provider && typeof provider.sendNotification === 'function') {
            const subject = `EcoSmart · Final Offer Funded: ₦${amount} for your ${listing.material_name}`;
            const text = `Hello ${listing.generator_name},\n\n${listing.recycler_name} has inspected your ${listing.material_name} (${actualQuantity} ${actualUnit}) and funded a final offer of ₦${amount}.\n\nZero commission guarantee: 100% of this amount will be paid to you upon acceptance.\n\nYou have 24 hours to review and accept this offer on EcoSmart: ${origin}\n\nThank you for recycling with EcoSmart!`;
            provider.sendNotification(listing.generator_email, subject, text).catch(() => {});
          }

          const updatedListing = db.prepare('SELECT * FROM listings WHERE id=?').get(listingId);
          const inspectionRecord = db.prepare('SELECT * FROM inspections WHERE id=?').get(inspectionId);
          const offerRecord = db.prepare('SELECT * FROM final_offers WHERE id=?').get(finalOfferId);
          const paymentRecord = db.prepare('SELECT * FROM wallet_payments WHERE id=?').get(paymentId);
          const updatedWallet = db.prepare('SELECT * FROM user_wallets WHERE user_id=?').get(user.id);

          return json(200, { ok: true, listing: updatedListing, inspection: inspectionRecord, finalOffer: offerRecord, payment: paymentRecord, wallet: updatedWallet });
        }
        if (path === '/api/generator/offer/decision') {
          const user = account(req);
          if (!user || user.role !== 'generator') throw new AppError(401, 'Please sign in as a generator.');
          const listingId = typeof input.listingId === 'string' ? input.listingId.trim() : '';
          const rawDecision = typeof input.decision === 'string' ? input.decision.trim().toLowerCase() : '';
          const decision = (rawDecision === 'accept' || rawDecision === 'accepted') ? 'accepted' : ((rawDecision === 'reject' || rawDecision === 'rejected') ? 'rejected' : rawDecision);
          const rejectionReason = typeof input.rejectionReason === 'string' ? input.rejectionReason.trim() : '';

          if (!listingId) throw new AppError(400, 'Listing ID is required.');
          if (!['accepted', 'rejected'].includes(decision)) throw new AppError(400, 'Decision must be accepted or rejected.');
          if (rejectionReason.length > 300) throw new AppError(400, 'Rejection reasons must be 300 characters or fewer.');

          const listing = db.prepare('SELECT * FROM listings WHERE id=?').get(listingId);
          if (!listing) throw new AppError(404, 'Listing not found.');
          if (listing.generator_user_id !== user.id) throw new AppError(403, 'You are not the owner of this listing.');

          const offer = db.prepare('SELECT * FROM final_offers WHERE listing_id=? ORDER BY created_at DESC LIMIT 1').get(listingId);
          if (!offer) throw new AppError(404, 'No final offer found for this listing.');
          if (offer.offer_status !== 'funded and sent') throw new AppError(400, `Offer is already in '${offer.offer_status}' status.`);

          const time = now();
          if (time >= offer.expires_at) throw new AppError(409, 'This offer has expired and is awaiting escrow settlement. Refresh and try again.');

          db.exec('BEGIN IMMEDIATE');
          try {
            const claimed = db.prepare("UPDATE final_offers SET offer_status=?, decision=?, decision_at=?, funding_status=?, rejection_reason=?, updated_at=? WHERE id=? AND offer_status='funded and sent' AND expires_at>?").run(
              decision,
              decision,
              time,
              decision === 'accepted' ? 'released' : 'returned',
              decision === 'rejected' ? (rejectionReason || 'Declined by generator') : null,
              time,
              offer.id,
              time
            );
            if (claimed.changes !== 1) throw new AppError(409, 'This offer was already decided or expired. Refresh to see its current status.');
            if (decision === 'accepted') {
              getOrCreateWallet(offer.recycler_user_id);
              const recWallet = db.prepare('SELECT * FROM user_wallets WHERE user_id=?').get(offer.recycler_user_id);
              if (!recWallet || recWallet.escrow_locked_balance < offer.amount) {
                throw new AppError(400, 'Escrow funding is incomplete or missing. Cannot release unbacked payout.');
              }

              const payoutPaymentId = randomUUID();
              const payoutRef = 'PAYOUT-' + randomBytes(4).toString('hex').toUpperCase();

              const listingUpdate = db.prepare("UPDATE listings SET status='completed', updated_at=? WHERE id=? AND status='funded final offer'").run(time, listingId);
              if (listingUpdate.changes !== 1) throw new AppError(409, 'Listing status changed while deciding this offer. Refresh and try again.');

              db.prepare(`
                INSERT INTO wallet_payments (id, final_offer_id, listing_id, payer_user_id, payee_user_id, payment_type, amount, commission_amount, currency, provider_name, provider_reference, status, created_at)
                VALUES (?, ?, ?, ?, ?, 'generator payout', ?, 0, 'NGN', 'EcoSmart Escrow', ?, 'released', ?)
              `).run(payoutPaymentId, offer.id, listingId, offer.recycler_user_id, user.id, offer.amount, payoutRef, time);

              // 1. Deduct recycler escrow lock
              db.prepare('UPDATE user_wallets SET escrow_locked_balance = escrow_locked_balance - ?, updated_at = ? WHERE user_id = ?').run(offer.amount, time, offer.recycler_user_id);

              // 2. Credit generator available balance
              getOrCreateWallet(user.id);
              db.prepare('UPDATE user_wallets SET available_balance = available_balance + ?, updated_at = ? WHERE user_id = ?').run(offer.amount, time, user.id);
              const genWallet = db.prepare('SELECT * FROM user_wallets WHERE user_id=?').get(user.id);

              db.prepare(`
                INSERT INTO wallet_transactions (id, user_id, type, amount, balance_after, listing_id, reference, description, status, created_at)
                VALUES (?, ?, 'payout_credit', ?, ?, ?, ?, ?, 'successful', ?)
              `).run(randomUUID(), user.id, offer.amount, genWallet.available_balance, listingId, payoutRef, `100% Payout for ${listing.material_name} deal`, time);

              db.prepare(`
                INSERT INTO transaction_events (id, listing_id, final_offer_id, event_type, actor_user_id, from_status, to_status, event_note, created_at)
                VALUES (?, ?, ?, 'offer_accepted', ?, 'funded final offer', 'completed', 'Generator accepted final offer.', ?)
              `).run(randomUUID(), listingId, offer.id, user.id, time);

              db.prepare(`
                INSERT INTO transaction_events (id, listing_id, final_offer_id, event_type, actor_user_id, from_status, to_status, event_note, created_at)
                VALUES (?, ?, ?, 'payout_released', ?, 'completed', 'completed', ?, ?)
              `).run(randomUUID(), listingId, offer.id, user.id, `₦${offer.amount} released to generator with ₦0 commission (Ref: ${payoutRef}).`, time);
            } else {
              const returnPaymentId = randomUUID();
              const returnRef = 'RETURN-' + randomBytes(4).toString('hex').toUpperCase();

              const listingUpdate = db.prepare("UPDATE listings SET status='offer rejected', updated_at=? WHERE id=? AND status='funded final offer'").run(time, listingId);
              if (listingUpdate.changes !== 1) throw new AppError(409, 'Listing status changed while deciding this offer. Refresh and try again.');

              db.prepare(`
                INSERT INTO wallet_payments (id, final_offer_id, listing_id, payer_user_id, payee_user_id, payment_type, amount, commission_amount, currency, provider_name, provider_reference, status, created_at)
                VALUES (?, ?, ?, ?, ?, 'funding returned', ?, 0, 'NGN', 'EcoSmart Escrow', ?, 'returned', ?)
              `).run(returnPaymentId, offer.id, listingId, user.id, offer.recycler_user_id, offer.amount, returnRef, time);

              // Unlock recycler escrow lock back to available balance
              const recWallet = getOrCreateWallet(offer.recycler_user_id);
              if (recWallet.escrow_locked_balance < offer.amount) throw new AppError(409, 'Escrow balance is inconsistent. The offer requires administrator reconciliation.');
              db.prepare('UPDATE user_wallets SET escrow_locked_balance = escrow_locked_balance - ?, available_balance = available_balance + ?, updated_at = ? WHERE user_id = ?').run(offer.amount, offer.amount, time, offer.recycler_user_id);
              const afterRecWallet = db.prepare('SELECT * FROM user_wallets WHERE user_id=?').get(offer.recycler_user_id);

              db.prepare(`
                INSERT INTO wallet_transactions (id, user_id, type, amount, balance_after, listing_id, reference, description, status, created_at)
                VALUES (?, ?, 'escrow_unlock', ?, ?, ?, ?, 'Escrow hold refunded for declined offer', 'successful', ?)
              `).run(randomUUID(), offer.recycler_user_id, offer.amount, afterRecWallet.available_balance, listingId, returnRef, time);

              db.prepare(`
                INSERT INTO transaction_events (id, listing_id, final_offer_id, event_type, actor_user_id, from_status, to_status, event_note, created_at)
                VALUES (?, ?, ?, 'offer_rejected', ?, 'funded final offer', 'offer rejected', ?, ?)
              `).run(randomUUID(), listingId, offer.id, user.id, `Generator rejected final offer. Reason: ${rejectionReason || 'No reason provided'}. Escrow returned.`, time);
            }
            db.exec('COMMIT');
          } catch (err) {
            db.exec('ROLLBACK');
            throw err;
          }

          const updatedListing = db.prepare('SELECT * FROM listings WHERE id=?').get(listingId);
          const updatedOffer = db.prepare('SELECT * FROM final_offers WHERE id=?').get(offer.id);
          const payments = db.prepare('SELECT * FROM wallet_payments WHERE listing_id=? ORDER BY created_at ASC').all(listingId);
          const latestPayment = payments[payments.length - 1];
          const freshWallet = getOrCreateWallet(user.id);

          return json(200, { ok: true, listing: updatedListing, finalOffer: updatedOffer, payment: latestPayment, payments, wallet: freshWallet });
        }
        if (path === '/api/listings/details') {
          const user = account(req);
          if (!user) throw new AppError(401, 'Please sign in to view listing details.');
          const listingId = typeof input.listingId === 'string' ? input.listingId.trim() : (new URL(req.url, origin).searchParams.get('id') || '');
          if (!listingId) throw new AppError(400, 'Listing ID is required.');

          const listing = db.prepare(`
            SELECT l.*, sm.name as material_name,
                   gu.id as generator_id, gu.name as generator_name, gu.email as generator_email, gu.area as generator_area,
                   ru.id as recycler_id, ru.name as recycler_contact_name,
                   COALESCE(ra.business_name, ru.name) as recycler_name, ra.area as recycler_area,
                   ra.contact_phone as recycler_phone, ra.business_address as recycler_yard_address
            FROM listings l
            JOIN supported_materials sm ON sm.id = l.material_id
            JOIN users gu ON gu.id = l.generator_user_id
            JOIN users ru ON ru.id = l.recycler_user_id
            LEFT JOIN recycler_applications ra ON ra.user_id = ru.id
            WHERE l.id=?
          `).get(listingId);

          if (!listing) throw new AppError(404, 'Listing not found.');
          if (listing.generator_id !== user.id && listing.recycler_id !== user.id) {
            throw new AppError(403, 'You do not have permission to view this listing.');
          }

          const time = now();
          const offer = db.prepare('SELECT * FROM final_offers WHERE listing_id=? ORDER BY created_at DESC LIMIT 1').get(listingId);
          const responseRecord = db.prepare('SELECT * FROM listing_responses WHERE listing_id=?').get(listingId);
          const inspectionRecord = db.prepare('SELECT * FROM inspections WHERE listing_id=?').get(listingId);
          const payments = db.prepare('SELECT * FROM wallet_payments WHERE listing_id=? ORDER BY created_at ASC').all(listingId);
          const events = db.prepare(`
            SELECT te.*, te.event_note as description,
                   COALESCE(u.role, 'system') as actor_role,
                   COALESCE(ra.business_name, u.name, 'EcoSmart System') as actor_name
            FROM transaction_events te
            LEFT JOIN users u ON u.id = te.actor_user_id
            LEFT JOIN recycler_applications ra ON ra.user_id = u.id
            WHERE te.listing_id=?
            ORDER BY te.created_at ASC
          `).all(listingId);

          const isAccepted = redactCounterpartyContacts(listing, user);

          return json(200, {
            ok: true,
            listing,
            response: responseRecord,
            inspection: inspectionRecord,
            finalOffer: offer,
            payments,
            events,
            contactsShared: isAccepted
          });
        }
        if (path === '/api/recycler/application') {
          const user = account(req);
          if (!user || user.role !== 'recycler') throw new AppError(401, 'Please sign in as a recycler to submit your verification application.');
          const businessName = typeof input.businessName === 'string' ? input.businessName.trim().replace(/\s+/g, ' ') : '';
          const contactPhone = typeof input.contactPhone === 'string' ? input.contactPhone.trim() : (typeof input.phone === 'string' ? input.phone.trim() : '');
          const businessAddress = typeof input.businessAddress === 'string' ? input.businessAddress.trim().replace(/\s+/g, ' ') : (typeof input.address === 'string' ? input.address.trim().replace(/\s+/g, ' ') : '');
          const contactDetails = typeof input.contactDetails === 'string' && input.contactDetails.trim() ? input.contactDetails.trim() : `${contactPhone}${businessAddress ? ' · ' + businessAddress : ''}`;
          const govIdType = typeof input.govIdType === 'string' ? input.govIdType.trim() : '';
          const govIdNumber = typeof input.govIdNumber === 'string' ? input.govIdNumber.trim() : '';
          const govIdFile = typeof input.govIdFile === 'string' ? input.govIdFile.trim() : '';
          const photoFile = typeof input.photoFile === 'string' ? input.photoFile.trim() : '';
          const licenceType = typeof input.licenceType === 'string' ? input.licenceType.trim() : '';
          const licenceNumber = typeof input.licenceNumber === 'string' ? input.licenceNumber.trim() : '';
          const licenceFile = typeof input.licenceFile === 'string' ? input.licenceFile.trim() : '';
          const area = typeof input.area === 'string' ? input.area.trim().replace(/\s+/g, ' ') : '';

          if (businessName.length < 2 || businessName.length > 150) throw new AppError(400, 'Enter your recycler/business name (2–150 characters).');
          if (contactPhone.length < 5 || contactPhone.length > 40) throw new AppError(400, 'Enter a valid contact phone number (5–40 characters).');
          if (businessAddress.length < 3 || businessAddress.length > 200) throw new AppError(400, 'Enter your physical business / yard address (3–200 characters).');
          if (!govIdType || govIdType.length > 50) throw new AppError(400, 'Select a valid Government ID type.');
          if (govIdNumber.length < 2 || govIdNumber.length > 50) throw new AppError(400, 'Enter your Government ID number.');
          if (!govIdFile) throw new AppError(400, 'Upload a clear document/scan of your Government ID.');
          if (!photoFile) throw new AppError(400, 'Upload a passport photograph or recycler photo.');
          if (!licenceType || licenceType.length > 100) throw new AppError(400, 'Select or enter your licence / registration type.');
          if (licenceNumber.length < 2 || licenceNumber.length > 50) throw new AppError(400, 'Enter your licence or registration number.');
          if (!licenceFile) throw new AppError(400, 'Upload your licence or registration document.');
          if (area.length < 2 || area.length > 120) throw new AppError(400, 'Enter your operating area or neighbourhood.');

          const existing = db.prepare('SELECT * FROM recycler_applications WHERE user_id=?').get(user.id);
          if (existing && existing.status === 'approved') throw new AppError(400, 'Your recycler profile is already approved.');

          const time = now();
          const appId = existing ? existing.id : randomUUID();
          db.exec('BEGIN IMMEDIATE');
          try {
            db.prepare(`
              INSERT OR REPLACE INTO recycler_applications (id, user_id, business_name, contact_phone, business_address, contact_details, gov_id_type, gov_id_number, gov_id_file, photo_file, licence_type, licence_number, licence_file, area, status, admin_user_id, admin_note, reviewed_at, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, ?, ?)
            `).run(appId, user.id, businessName, contactPhone, businessAddress, contactDetails, govIdType, govIdNumber, govIdFile, photoFile, licenceType, licenceNumber, licenceFile, area, existing ? existing.created_at : time, time);
            db.prepare("UPDATE users SET account_status='pending recycler approval', updated_at=? WHERE id=?").run(time, user.id);
            db.exec('COMMIT');
          } catch (err) { db.exec('ROLLBACK'); throw err; }

          const updatedApp = db.prepare('SELECT * FROM recycler_applications WHERE id=?').get(appId);
          const updatedUser = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
          return json(200, { ok: true, application: updatedApp, user: publicAccount(updatedUser) });
        }
        if (path === '/api/admin/review-application') {
          const user = account(req);
          if (!user) throw new AppError(401, 'Authentication required.');
          if (user.role !== 'administrator') throw new AppError(403, 'Administrator access required.');
          const applicationId = typeof input.applicationId === 'string' ? input.applicationId.trim() : '';
          const decision = input.decision;
          const note = typeof input.note === 'string' ? input.note.trim() : '';
          if (!applicationId) throw new AppError(400, 'Application ID is required.');
          if (!['approved', 'rejected'].includes(decision)) throw new AppError(400, 'Decision must be approved or rejected.');
          
          const app = db.prepare('SELECT * FROM recycler_applications WHERE id=?').get(applicationId);
          if (!app) throw new AppError(404, 'Application not found.');
          if (app.user_id === user.id) throw new AppError(403, 'Administrators cannot review their own application.');

          const time = now();
          db.exec('BEGIN IMMEDIATE');
          try {
            db.prepare('UPDATE recycler_applications SET status=?, admin_user_id=?, admin_note=?, reviewed_at=?, updated_at=? WHERE id=?').run(
              decision,
              user.id,
              note || (decision === 'approved' ? 'Verified by administrator.' : 'Verification requirements not met.'),
              time,
              time,
              applicationId
            );
            db.prepare('UPDATE users SET account_status=?, updated_at=? WHERE id=?').run(
              decision === 'approved' ? 'active' : 'rejected',
              time,
              app.user_id
            );
            db.exec('COMMIT');
          } catch (err) { db.exec('ROLLBACK'); throw err; }

          const updatedApp = db.prepare('SELECT * FROM recycler_applications WHERE id=?').get(applicationId);
          const updatedUser = db.prepare('SELECT * FROM users WHERE id=?').get(app.user_id);
          return json(200, { ok: true, application: updatedApp, user: publicAccount(updatedUser) });
        }
        if (path === '/api/admin/applications') {
          const user = account(req);
          if (!user) throw new AppError(401, 'Please sign in to access the administrator workspace.');
          if (user.role !== 'administrator') throw new AppError(403, 'Administrator access required.');
          const applications = db.prepare(`
            SELECT ra.*, u.name as applicant_name, u.email as applicant_email, u.area as user_area, u.account_status
            FROM recycler_applications ra
            JOIN users u ON u.id = ra.user_id
            ORDER BY CASE ra.status WHEN 'pending' THEN 1 WHEN 'approved' THEN 2 ELSE 3 END, ra.created_at DESC
          `).all();
          const stats = {
            total: applications.length,
            pending: applications.filter(a => a.status === 'pending').length,
            approved: applications.filter(a => a.status === 'approved').length,
            rejected: applications.filter(a => a.status === 'rejected').length
          };
          return json(200, { ok: true, applications, stats });
        }
        if (path === '/api/admin/materials') {
          const materials = db.prepare('SELECT * FROM supported_materials ORDER BY rowid ASC').all();
          return json(200, { ok: true, materials });
        }
        if (path === '/api/admin/materials/save') {
          const user = account(req);
          const rawId = typeof input.id === 'string' ? input.id.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_') : '';
          const name = typeof input.name === 'string' ? input.name.trim() : '';
          const guidance = typeof input.guidance === 'string' ? input.guidance.trim() : '';
          const recyclable = input.recyclable === false || input.recyclable === 0 ? 0 : 1;
          const active = input.active === false || input.active === 0 ? 0 : 1;

          if (!name || name.length < 2) throw new AppError(400, 'Material name must be at least 2 characters.');
          if (!guidance || guidance.length < 5) throw new AppError(400, 'Guidance instructions must be at least 5 characters.');

          const id = rawId || name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
          if (!id) throw new AppError(400, 'A valid material identifier is required.');

          const time = now();
          const existing = db.prepare('SELECT * FROM supported_materials WHERE id=?').get(id);

          db.exec('BEGIN IMMEDIATE');
          try {
            if (existing) {
              db.prepare('UPDATE supported_materials SET name=?, guidance=?, recyclable=?, active=? WHERE id=?').run(name, guidance, recyclable, active, id);
            } else {
              db.prepare('INSERT INTO supported_materials (id, name, active, recyclable, guidance, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, name, active, recyclable, guidance, time);
            }
            db.exec('COMMIT');
          } catch (err) { db.exec('ROLLBACK'); throw err; }

          const allMaterials = db.prepare('SELECT * FROM supported_materials ORDER BY rowid ASC').all();
          const savedMaterial = db.prepare('SELECT * FROM supported_materials WHERE id=?').get(id);
          return json(200, { ok: true, material: savedMaterial, materials: allMaterials });
        }
        if (path === '/api/admin/records') {
          const query = typeof input.query === 'string' ? input.query.trim().toLowerCase() : '';
          const status = typeof input.status === 'string' ? input.status.trim() : '';
          const materialId = typeof input.materialId === 'string' ? input.materialId.trim() : '';

          let sql = `
            SELECT l.*, sm.name as material_name,
                   gu.id as generator_id, gu.name as generator_name, gu.email as generator_email, gu.area as generator_area,
                   ru.id as recycler_id, ru.name as recycler_contact_name,
                   COALESCE(ra.business_name, ru.name) as recycler_name, ra.area as recycler_area,
                   ra.contact_phone as recycler_phone, ra.business_address as recycler_yard_address,
                   fo.amount as final_offer_amount, fo.offer_status, fo.expires_at as offer_expires_at,
                   insp.actual_quantity, insp.actual_unit, insp.inspection_note
            FROM listings l
            JOIN supported_materials sm ON sm.id = l.material_id
            JOIN users gu ON gu.id = l.generator_user_id
            JOIN users ru ON ru.id = l.recycler_user_id
            LEFT JOIN recycler_applications ra ON ra.user_id = ru.id
            LEFT JOIN final_offers fo ON fo.listing_id = l.id
            LEFT JOIN inspections insp ON insp.listing_id = l.id
            WHERE 1=1
          `;
          const params = [];

          if (status) {
            sql += ' AND l.status = ?';
            params.push(status);
          }
          if (materialId) {
            sql += ' AND l.material_id = ?';
            params.push(materialId);
          }
          if (query) {
            sql += ` AND (
              LOWER(l.id) LIKE ? OR
              LOWER(sm.name) LIKE ? OR
              LOWER(gu.name) LIKE ? OR
              LOWER(gu.email) LIKE ? OR
              LOWER(COALESCE(ra.business_name, ru.name)) LIKE ? OR
              LOWER(l.location_address) LIKE ?
            )`;
            const qPattern = `%${query}%`;
            params.push(qPattern, qPattern, qPattern, qPattern, qPattern, qPattern);
          }

          sql += ' ORDER BY l.created_at DESC LIMIT 100';

  const records = db.prepare(sql).all(...params);
          const stats = {
            totalListings: db.prepare('SELECT COUNT(*) as c FROM listings').get().c,
            completed: db.prepare("SELECT COUNT(*) as c FROM listings WHERE status='completed'").get().c,
            activeOffers: db.prepare("SELECT COUNT(*) as c FROM listings WHERE status='funded final offer'").get().c,
            handoverCoordinated: db.prepare("SELECT COUNT(*) as c FROM listings WHERE status IN ('accepted', 'handover arranged')").get().c
          };

          return json(200, { ok: true, records, stats });
        }
        if (path === '/api/user/records') {
          const user = account(req);
          if (!user) throw new AppError(401, 'Please sign in to view transaction records.');
          const query = typeof input.query === 'string' ? input.query.trim().toLowerCase() : '';
          const status = typeof input.status === 'string' ? input.status.trim() : '';

          let sql = `
            SELECT l.*, sm.name as material_name,
                   gu.id as generator_id, gu.name as generator_name, gu.email as generator_email, gu.area as generator_area,
                   ru.id as recycler_id, ru.name as recycler_contact_name,
                   COALESCE(ra.business_name, ru.name) as recycler_name, ra.area as recycler_area,
                   ra.contact_phone as recycler_phone, ra.business_address as recycler_yard_address,
                   fo.id as final_offer_id, fo.amount as final_offer_amount, fo.offer_status, fo.funding_status, fo.expires_at as offer_expires_at, fo.rejection_reason,
                   insp.id as inspection_id, insp.actual_quantity, insp.actual_unit, insp.inspection_note,
                   lr.response as recycler_response, lr.agreed_arrangement, lr.arrangement_note, lr.decline_reason,
                   (SELECT provider_reference FROM wallet_payments WHERE listing_id = l.id ORDER BY CASE payment_type WHEN 'generator payout' THEN 1 ELSE 2 END, created_at DESC LIMIT 1) as payment_ref,
                   (SELECT status FROM wallet_payments WHERE listing_id = l.id ORDER BY CASE payment_type WHEN 'generator payout' THEN 1 ELSE 2 END, created_at DESC LIMIT 1) as payment_status
            FROM listings l
            JOIN supported_materials sm ON sm.id = l.material_id
            JOIN users gu ON gu.id = l.generator_user_id
            JOIN users ru ON ru.id = l.recycler_user_id
            LEFT JOIN recycler_applications ra ON ra.user_id = ru.id
            LEFT JOIN final_offers fo ON fo.listing_id = l.id
            LEFT JOIN inspections insp ON insp.listing_id = l.id
            LEFT JOIN listing_responses lr ON lr.listing_id = l.id
            WHERE (l.generator_user_id = ? OR l.recycler_user_id = ?)
          `;
          const params = [user.id, user.id];

          if (status) {
            if (status === 'in_progress') {
              sql += " AND l.status IN ('sent to recycler', 'accepted', 'handover arranged', 'inspected', 'funded final offer')";
            } else if (status === 'completed') {
              sql += " AND l.status = 'completed'";
            } else if (status === 'declined_rejected') {
              sql += " AND l.status IN ('declined', 'offer rejected', 'rejected final offer')";
            } else if (status === 'expired') {
              sql += " AND l.status = 'expired'";
            } else {
              sql += " AND l.status = ?";
              params.push(status);
            }
          }

          if (query) {
            sql += ` AND (
              LOWER(l.id) LIKE ? OR
              LOWER(sm.name) LIKE ? OR
              LOWER(gu.name) LIKE ? OR
              LOWER(COALESCE(ra.business_name, ru.name)) LIKE ? OR
              LOWER(l.location_address) LIKE ? OR
              LOWER(COALESCE((SELECT provider_reference FROM wallet_payments WHERE listing_id = l.id LIMIT 1), '')) LIKE ?
            )`;
            const qPattern = `%${query}%`;
            params.push(qPattern, qPattern, qPattern, qPattern, qPattern, qPattern);
          }

          sql += ' ORDER BY l.created_at DESC';
          const records = db.prepare(sql).all(...params);
          for (const record of records) redactCounterpartyContacts(record, user);

          // Calculate user-specific metrics across all user transactions
          const allUserListings = db.prepare(`
            SELECT l.*, fo.amount as final_offer_amount, insp.actual_quantity
            FROM listings l
            LEFT JOIN final_offers fo ON fo.listing_id = l.id
            LEFT JOIN inspections insp ON insp.listing_id = l.id
            WHERE (l.generator_user_id = ? OR l.recycler_user_id = ?)
          `).all(user.id, user.id);

          let totalVolumeKg = 0;
          let totalEarningsNaira = 0;
          let completedCount = 0;
          let activeCount = 0;

          for (const item of allUserListings) {
            if (item.status === 'completed') {
              completedCount++;
              if (item.final_offer_amount) totalEarningsNaira += Number(item.final_offer_amount);
              if (item.actual_quantity) totalVolumeKg += Number(item.actual_quantity);
              else if (item.declared_quantity) totalVolumeKg += Number(item.declared_quantity);
            } else if (['sent to recycler', 'accepted', 'handover arranged', 'funded final offer', 'inspected'].includes(item.status)) {
              activeCount++;
            }
          }

          const stats = {
            totalListings: allUserListings.length,
            completed: completedCount,
            active: activeCount,
            totalVolumeKg: Math.round(totalVolumeKg * 10) / 10,
            totalAmount: totalEarningsNaira,
            role: user.role
          };

          return json(200, { ok: true, records, stats });
        }
        if (path === '/api/user/record-details') {
          const user = account(req);
          if (!user) throw new AppError(401, 'Please sign in to view transaction details.');
          const listingId = typeof input.listingId === 'string' ? input.listingId.trim() : '';
          if (!listingId) throw new AppError(400, 'Listing ID is required.');

          const listing = db.prepare(`
            SELECT l.*, sm.name as material_name,
                   gu.id as generator_id, gu.name as generator_name, gu.email as generator_email, gu.area as generator_area,
                   ru.id as recycler_id, ru.name as recycler_contact_name,
                   COALESCE(ra.business_name, ru.name) as recycler_name, ra.area as recycler_area,
                   ra.contact_phone as recycler_phone, ra.business_address as recycler_yard_address
            FROM listings l
            JOIN supported_materials sm ON sm.id = l.material_id
            JOIN users gu ON gu.id = l.generator_user_id
            JOIN users ru ON ru.id = l.recycler_user_id
            LEFT JOIN recycler_applications ra ON ra.user_id = ru.id
            WHERE l.id=?
          `).get(listingId);

          if (!listing) throw new AppError(404, 'Transaction record not found.');
          if (listing.generator_user_id !== user.id && listing.recycler_user_id !== user.id) {
            throw new AppError(403, 'You do not have permission to view this transaction record.');
          }
          redactCounterpartyContacts(listing, user);

          const responseRecord = db.prepare('SELECT * FROM listing_responses WHERE listing_id=? ORDER BY created_at DESC LIMIT 1').get(listingId);
          const inspection = db.prepare('SELECT * FROM inspections WHERE listing_id=? ORDER BY created_at DESC LIMIT 1').get(listingId);
          const finalOffer = db.prepare('SELECT * FROM final_offers WHERE listing_id=? ORDER BY created_at DESC LIMIT 1').get(listingId);
          const payments = db.prepare('SELECT * FROM wallet_payments WHERE listing_id=? ORDER BY created_at ASC').all(listingId);
          const events = db.prepare('SELECT * FROM transaction_events WHERE listing_id=? ORDER BY created_at ASC').all(listingId);

          return json(200, {
            ok: true,
            listing,
            response: responseRecord,
            inspection,
            finalOffer,
            payment: payments[payments.length - 1] || null,
            payments,
            events
          });
        }
        if (path === '/api/chat/messages') {
          const user = account(req);
          if (!user) throw new AppError(401, 'Please sign in to view chat messages.');
          const listingId = typeof input.listingId === 'string' ? input.listingId.trim() : '';
          if (!listingId) throw new AppError(400, 'Listing ID is required.');

          const listing = db.prepare('SELECT * FROM listings WHERE id=?').get(listingId);
          if (!listing) throw new AppError(404, 'Listing not found.');
          if (listing.generator_user_id !== user.id && listing.recycler_user_id !== user.id) {
            throw new AppError(403, 'You do not have permission to view chat for this listing.');
          }

          if (!['accepted', 'handover arranged', 'funded final offer', 'inspected', 'completed'].includes(listing.status)) {
            throw new AppError(400, 'Chat is only available for accepted and active transactions.');
          }

          const messages = db.prepare(`
            SELECT cm.*, u.name as sender_name, u.role as sender_role
            FROM chat_messages cm
            JOIN users u ON u.id = cm.sender_user_id
            WHERE cm.listing_id = ?
            ORDER BY cm.created_at ASC
          `).all(listingId);

          return json(200, { ok: true, listingId, messages });
        }
        if (path === '/api/chat/send') {
          const user = account(req);
          if (!user) throw new AppError(401, 'Please sign in to send messages.');
          const listingId = typeof input.listingId === 'string' ? input.listingId.trim() : '';
          const messageText = typeof input.message === 'string' ? input.message.trim() : '';

          if (!listingId) throw new AppError(400, 'Listing ID is required.');
          if (!messageText || messageText.length < 1) throw new AppError(400, 'Message cannot be empty.');
          if (messageText.length > 1000) throw new AppError(400, 'Message must be 1000 characters or fewer.');

          const listing = db.prepare('SELECT * FROM listings WHERE id=?').get(listingId);
          if (!listing) throw new AppError(404, 'Listing not found.');
          if (listing.generator_user_id !== user.id && listing.recycler_user_id !== user.id) {
            throw new AppError(403, 'You do not have permission to send messages on this listing.');
          }

          if (!['accepted', 'handover arranged', 'funded final offer', 'inspected', 'completed'].includes(listing.status)) {
            throw new AppError(400, 'Chat is only available for accepted and active transactions.');
          }

          const recipientUserId = listing.generator_user_id === user.id ? listing.recycler_user_id : listing.generator_user_id;
          const time = now();
          const messageId = randomUUID();

          db.prepare(`
            INSERT INTO chat_messages (id, listing_id, sender_user_id, recipient_user_id, message, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(messageId, listingId, user.id, recipientUserId, messageText, time);

          const createdMessage = {
            id: messageId,
            listing_id: listingId,
            sender_user_id: user.id,
            recipient_user_id: recipientUserId,
            sender_name: user.name,
            sender_role: user.role,
            message: messageText,
            created_at: time
          };

          return json(200, { ok: true, message: createdMessage });
        }
        if (path.startsWith('/api/call/')) {
          if (!account(req)) throw new AppError(401, 'Please sign in.');
          throw new AppError(503, 'Voice calls are not available yet. Use the listing chat to coordinate handover.');
        }
        if (path === '/api/recycler/settings') {
          const user = account(req);
          if (!user || user.role !== 'recycler') throw new AppError(401, 'Please sign in as a recycler.');
          const app = db.prepare('SELECT status FROM recycler_applications WHERE user_id=?').get(user.id);
          if (!app || app.status !== 'approved') throw new AppError(403, 'Your recycler profile must be approved before configuring marketplace settings.');

          const settingsList = Array.isArray(input.settings) ? input.settings : [];
          if (settingsList.length === 0) throw new AppError(400, 'Provide at least one material setting.');

          const validMaterials = db.prepare('SELECT id FROM supported_materials WHERE active=1').all().map(m => m.id);
          const validUnits = ['per kilogram', 'per item', 'per bag'];
          const time = now();

          db.exec('BEGIN IMMEDIATE');
          try {
            for (const item of settingsList) {
              if (!validMaterials.includes(item.materialId)) throw new AppError(400, `Unsupported pilot material: ${item.materialId}`);
              const accepted = item.accepted ? 1 : 0;
              const price = typeof item.price === 'number' ? item.price : Number(item.price);
              if (!Number.isFinite(price) || price < 0 || (accepted && price <= 0)) throw new AppError(400, 'Accepted materials require a positive estimated price in naira.');
              const unit = typeof item.unit === 'string' && validUnits.includes(item.unit) ? item.unit : 'per kilogram';

              const existingSetting = db.prepare('SELECT id FROM recycler_material_settings WHERE user_id=? AND material_id=?').get(user.id, item.materialId);
              if (existingSetting) {
                db.prepare('UPDATE recycler_material_settings SET accepted=?, price=?, unit=?, updated_at=? WHERE id=?').run(accepted, price, unit, time, existingSetting.id);
              } else {
                db.prepare('INSERT INTO recycler_material_settings (id, user_id, material_id, accepted, price, unit, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), user.id, item.materialId, accepted, price, unit, time, time);
              }
            }
            if (typeof input.availability === 'string' && ['available', 'unavailable'].includes(input.availability)) {
              db.prepare('INSERT OR REPLACE INTO recycler_availability (user_id, availability, updated_at) VALUES (?, ?, ?)').run(user.id, input.availability, time);
            }
            db.exec('COMMIT');
          } catch (err) { db.exec('ROLLBACK'); throw err; }

          const updatedSettings = db.prepare('SELECT * FROM recycler_material_settings WHERE user_id=?').all(user.id);
          const availRow = db.prepare('SELECT availability FROM recycler_availability WHERE user_id=?').get(user.id);
          return json(200, { ok: true, materialSettings: updatedSettings, availability: availRow ? availRow.availability : 'available' });
        }
        if (path === '/api/recycler/availability') {
          const user = account(req);
          if (!user || user.role !== 'recycler') throw new AppError(401, 'Please sign in as a recycler.');
          const app = db.prepare('SELECT status FROM recycler_applications WHERE user_id=?').get(user.id);
          if (!app || app.status !== 'approved') throw new AppError(403, 'Your recycler profile must be approved to update availability.');

          const availability = input.availability;
          if (!['available', 'unavailable'].includes(availability)) throw new AppError(400, 'Availability must be available or unavailable.');
          const time = now();
          db.prepare('INSERT OR REPLACE INTO recycler_availability (user_id, availability, updated_at) VALUES (?, ?, ?)').run(user.id, availability, time);
          return json(200, { ok: true, availability });
        }
        if (path === '/api/logout') {
          const value = cookies(req).eco_session;
          if (value) db.prepare('DELETE FROM sessions WHERE id=?').run(hash(value));
          res.setHeader('Set-Cookie', [cookie('eco_session', '', 0), cookie('eco_pending', '', 0)]);
          return json(200, { ok: true });
        }
        throw new AppError(404, 'Not found.');
      }
      const files = { '/': ['public/index.html', 'text/html; charset=utf-8'], '/styles.css': ['public/styles.css', 'text/css'], '/app.js': ['public/app.js', 'text/javascript'] };
      if (req.method !== 'GET' || !files[path]) throw new AppError(404, 'Not found.');
      res.writeHead(200, { 'Content-Type': files[path][1] }); res.end(readFileSync(resolve(root, files[path][0])));
    } catch (error) { if (!(error instanceof AppError)) console.error('Request failed:', error.code || error.name); json(error.status || 500, { error: error instanceof AppError ? error.message : 'Something went wrong. Please try again.' }); }
  });
  const expiryTimer = setInterval(() => {
    try { expireOffers(); } catch (error) { console.error('Offer expiry failed:', error.code || error.name); }
  }, 30000);
  expiryTimer.unref();
  server.on('close', () => clearInterval(expiryTimer));
  return { server, db };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const { server, db } = createApp();

  // Bootstrap initial administrator for live testing and operations
  const adminEmail = (process.env.ADMIN_EMAIL || 'yusnaj21@yahoo.com').trim().toLowerCase();
  const now = Date.now();
  const existing = db.prepare('SELECT id, role FROM users WHERE email=?').get(adminEmail);
  if (!existing) {
    db.prepare(`
      INSERT INTO users (id, role, name, email, area, verification_status, account_status, created_at, updated_at)
      VALUES (?, 'administrator', 'Najeeb Yusuf (Admin)', ?, 'Headquarters, Lagos', 'verified', 'active', ?, ?)
    `).run(randomUUID(), adminEmail, now, now);
    console.log(`[EcoSmart] Bootstrapped administrator account: ${adminEmail}`);
  } else if (existing.role !== 'administrator') {
    db.prepare("UPDATE users SET role='administrator', updated_at=? WHERE email=?").run(now, adminEmail);
    console.log(`[EcoSmart] Promoted user to administrator: ${adminEmail}`);
  }

  // Ensure yusnaj21@gmail.com is not an administrator
  const gmailUser = db.prepare("SELECT id, role FROM users WHERE email='yusnaj21@gmail.com'").get();
  if (gmailUser && gmailUser.role === 'administrator') {
    db.prepare("UPDATE users SET role='generator', updated_at=? WHERE email='yusnaj21@gmail.com'").run(now);
  }

  const host = process.env.HOST || '0.0.0.0';
  server.listen(port, host, () => console.log(`EcoSmart running at http://${host}:${port}`));
}
