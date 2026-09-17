import { adminRequest, seedWallet } from '../test-support/admin.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash, randomBytes } from 'node:crypto';
import { createApp, sameArea } from '../server.js';

async function fixture(t, options = {}) {
  let time = Date.now();
  const messages = [];
  const notifications = [];
  const provider = {
    configured: true,
    send: async (email, code) => { messages.push({ email, code }); return 'email_test'; },
    sendNotification: async (email, subject, message) => { notifications.push({ email, subject, message }); return 'notif_test'; },
    ...options.provider
  };
  const app = createApp({ demoPayments: true, dbPath: ':memory:', now: () => time, ...options, provider, origin: 'http://localhost:3000' });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); app.db.close(); });

  function makeClient() {
    let cookie = '';
    async function request(path, data, headers = {}) {
      const response = await fetch(`http://127.0.0.1:${app.server.address().port}${path}`, {
        method: data === undefined ? 'GET' : 'POST',
        headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json', Cookie: cookie, ...headers },
        body: data === undefined ? undefined : JSON.stringify(data)
      });
      const jar = Object.fromEntries(cookie.split('; ').filter(Boolean).map(x => x.split('=')));
      for (const item of response.headers.getSetCookie()) {
        const [key, value] = item.split(';')[0].split('=');
        jar[key] = value;
      }
      cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
      return { status: response.status, data: await response.json(), headers: response.headers };
    }

    async function registerAndVerify(details) {
      await request('/api/register', details);
      const code = messages.at(-1)?.code;
      return await request('/api/verify', { code });
    }

    return { request, registerAndVerify };
  }

  return { ...app, makeClient, messages, notifications, advance: ms => time += ms, now: () => time };
}

test('Critical Fix 1: Admin authorization and self-review protection', async t => {
  const env = await fixture(t);
  const unauthClient = env.makeClient();
  const genClient = env.makeClient();
  const recClient = env.makeClient();

  await genClient.registerAndVerify({ role: 'generator', name: 'Gen User', email: 'gen@test.ng', area: 'Ikeja, Lagos' });
  await recClient.registerAndVerify({ role: 'recycler', name: 'Rec User', email: 'rec@test.ng', area: 'Ikeja, Lagos' });

  // 1. Unauthenticated requests are rejected
  const unauthQueue = await unauthClient.request('/api/admin/applications', {});
  assert.equal(unauthQueue.status, 401);

  // 2. Generator role is forbidden
  const genQueue = await genClient.request('/api/admin/applications', {});
  assert.equal(genQueue.status, 403);
  assert.match(genQueue.data.error, /Administrator access required/);

  // 3. Recycler role is forbidden
  const recQueue = await recClient.request('/api/admin/applications', {});
  assert.equal(recQueue.status, 403);
  assert.match(recQueue.data.error, /Administrator access required/);

  // Submit a recycler application
  const appSubmit = await recClient.request('/api/recycler/application', {
    businessName: 'Ikeja Green Recyclers',
    contactPhone: '+234 802 000 1111',
    businessAddress: '10 Industrial Way, Ikeja',
    govIdType: 'NIN',
    govIdNumber: '12345678901',
    govIdFile: 'data:image/png;base64,gov',
    photoFile: 'data:image/png;base64,photo',
    licenceType: 'CAC',
    licenceNumber: 'RC-123456',
    licenceFile: 'data:image/png;base64,lic',
    area: 'Ikeja, Lagos'
  });
  assert.equal(appSubmit.status, 200);
  const applicationId = appSubmit.data.application.id;

  // 4. Recycler cannot self-review their own application
  const selfReview = await recClient.request('/api/admin/review-application', {
    applicationId,
    decision: 'approved',
    note: 'I approve myself'
  });
  assert.equal(selfReview.status, 403);
  assert.match(selfReview.data.error, /Administrator access required/);

  // 5. Test administrator reviewing their own application if an administrator submitted one
  const adminId = randomUUID();
  const adminToken = randomBytes(32).toString('hex');
  env.db.prepare("INSERT INTO users VALUES (?, 'administrator', 'Admin Officer', 'admin@ecosmart.ng', 'Ikeja, Lagos', 'verified', 'active', 0, 0)").run(adminId);
  const adminSessionId = createHash('sha256').update(adminToken).digest('hex');
  env.db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(adminSessionId, adminId, Number.MAX_SAFE_INTEGER);

  // Insert application owned by this admin
  const adminAppId = randomUUID();
  env.db.prepare(`
    INSERT INTO recycler_applications (id, user_id, business_name, contact_phone, business_address, contact_details, gov_id_type, gov_id_number, gov_id_file, photo_file, licence_type, licence_number, licence_file, area, status, created_at, updated_at)
    VALUES (?, ?, 'Admin Yard', '08011112222', 'Address', 'details', 'NIN', '123', 'file', 'photo', 'CAC', '456', 'lic', 'Ikeja', 'pending', 0, 0)
  `).run(adminAppId, adminId);

  // Admin attempts to review their own application
  const selfAdminReviewRes = await fetch(`http://127.0.0.1:${env.server.address().port}/api/admin/review-application`, {
    method: 'POST',
    headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json', Cookie: `eco_session=${adminToken}` },
    body: JSON.stringify({ applicationId: adminAppId, decision: 'approved', note: 'Self approve' })
  });
  const selfAdminReview = await selfAdminReviewRes.json();
  assert.equal(selfAdminReviewRes.status, 403);
  assert.match(selfAdminReview.error, /Administrators cannot review their own application/);

  // 6. Valid administrator can view queue and review other users' applications
  const validAdminQueue = await adminRequest(env, '/api/admin/applications', {});
  assert.equal(validAdminQueue.status, 200);
  assert.ok(validAdminQueue.data.applications.some(a => a.id === applicationId));

  const validReview = await adminRequest(env, '/api/admin/review-application', {
    applicationId,
    decision: 'approved',
    note: 'Legitimate CAC and NIN verified.'
  });
  assert.equal(validReview.status, 200);
  assert.equal(validReview.data.application.status, 'approved');
});

test('Critical Fix 2: Escrow payout integrity prevents unbacked currency creation', async t => {
  const env = await fixture(t);
  const genClient = env.makeClient();
  const recClient = env.makeClient();

  await genClient.registerAndVerify({ role: 'generator', name: 'Gen User', email: 'gen2@test.ng', area: 'Ikeja, Lagos' });
  await recClient.registerAndVerify({ role: 'recycler', name: 'Rec User', email: 'rec2@test.ng', area: 'Ikeja, Lagos' });

  // Recycler verification and marketplace setup
  const recUser = env.db.prepare("SELECT id FROM users WHERE email='rec2@test.ng'").get();
  env.db.prepare("UPDATE users SET verification_status='approved' WHERE id=?").run(recUser.id);
  env.db.prepare(`
    INSERT INTO recycler_applications (id, user_id, business_name, contact_phone, business_address, contact_details, gov_id_type, gov_id_number, gov_id_file, photo_file, licence_type, licence_number, licence_file, area, status, created_at, updated_at)
    VALUES (?, ?, 'Apex Recyclers Ltd', '+234800000000', '10 Ikeja Way', 'details', 'NIN', '111', 'gov_file', 'photo_file', 'CAC', '222', 'lic_file', 'Ikeja, Lagos', 'approved', 0, 0)
  `).run(randomUUID(), recUser.id);

  await recClient.request('/api/recycler/settings', {
    settings: [{ materialId: 'cardboard', accepted: true, price: 200, unit: 'per kilogram' }],
    availability: 'available'
  });

  // Generator creates listing
  const listRes = await genClient.request('/api/generator/listings', {
    recyclerId: recUser.id,
    materialId: 'cardboard',
    description: 'Clean boxes',
    declaredQuantity: 100,
    quantityUnit: 'kg',
    preferredArrangement: 'pickup',
    locationAddress: '25 Oba Akran Ave, Ikeja'
  });
  assert.equal(listRes.status, 200);
  const listingId = listRes.data.listing.id;

  // Recycler accepts listing
  await recClient.request('/api/recycler/listings/respond', {
    listingId,
    decision: 'accepted',
    agreedArrangement: 'pickup',
    arrangementNote: 'Pickup scheduled'
  });

  // Handover completed
  await recClient.request('/api/recycler/listings/handover-complete', { listingId });

  // Recycler funds wallet with 200,000 NGN
  const topupRes = await recClient.request('/api/wallet/topup', { amount: 200000 });
  assert.equal(topupRes.status, 200);

  // Recycler inspects and submits final offer for 75,000 NGN (locks escrow)
  const offerRes = await recClient.request('/api/recycler/inspection/submit-offer', {
    listingId,
    actualQuantity: 100,
    quantityUnit: 'kg',
    inspectionNotes: 'Weighed on digital scale',
    amount: 75000
  });
  assert.equal(offerRes.status, 200);

  // Check Recycler wallet has 75,000 locked in escrow
  let recWallet = env.db.prepare('SELECT * FROM user_wallets WHERE user_id=?').get(recUser.id);
  assert.equal(recWallet.escrow_locked_balance, 75000);

  // SIMULATE TAMPERED / UNBACKED SCENARIO:
  // Artificially zero out recycler's escrow_locked_balance to simulate an unfunded or de-synchronized offer
  env.db.prepare('UPDATE user_wallets SET escrow_locked_balance=0 WHERE user_id=?').run(recUser.id);

  // Generator attempts to accept the offer
  const acceptRes = await genClient.request('/api/generator/offer/decision', {
    listingId,
    decision: 'accept'
  });

  // MUST BE REJECTED! Payout cannot be created from thin air
  assert.equal(acceptRes.status, 400);
  assert.match(acceptRes.data.error, /Escrow funding is incomplete or missing/);

  // Restore escrow balance and accept successfully
  env.db.prepare('UPDATE user_wallets SET escrow_locked_balance=75000 WHERE user_id=?').run(recUser.id);
  const validAcceptRes = await genClient.request('/api/generator/offer/decision', {
    listingId,
    decision: 'accept'
  });
  assert.equal(validAcceptRes.status, 200);

  // Verify generator received 75,000 NGN credited
  const genUser = env.db.prepare("SELECT id FROM users WHERE email='gen2@test.ng'").get();
  const genWallet = env.db.prepare('SELECT * FROM user_wallets WHERE user_id=?').get(genUser.id);
  assert.equal(genWallet.available_balance, 75000);

  // Verify recycler escrow cleared
  recWallet = env.db.prepare('SELECT * FROM user_wallets WHERE user_id=?').get(recUser.id);
  assert.equal(recWallet.escrow_locked_balance, 0);
});

test('Critical Fix 3: Area matching tokenization and locality precision', () => {
  // Same locality with state/suffix
  assert.equal(sameArea('Ikeja', 'Ikeja, Lagos'), true);
  assert.equal(sameArea('Ikeja, Lagos', 'Ikeja'), true);
  assert.equal(sameArea('Lekki Phase 1', 'Lekki, Lagos'), true);
  assert.equal(sameArea('Surulere', 'Surulere, Lagos, Nigeria'), true);

  // Different localities in same state must NOT match
  assert.equal(sameArea('Ikeja, Lagos', 'Victoria Island, Lagos'), false);
  assert.equal(sameArea('Surulere, Lagos', 'Ikeja, Lagos'), false);
  assert.equal(sameArea('Yaba, Lagos', 'Lekki Phase 1, Lagos'), false);
  assert.equal(sameArea('Abuja, FCT', 'Ikeja, Lagos'), false);

  // Empty or invalid
  assert.equal(sameArea('', 'Ikeja'), false);
  assert.equal(sameArea(null, 'Ikeja'), false);
});
