import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

export function openStorage(dbPath) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  // Archive the previous SMS schema atomically, preserving all original records.
  // SMS sessions cannot authenticate an email account.
  if (db.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'phone')) {
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const name of ['users', 'registrations', 'sessions', 'limits']) {
        if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name)) db.exec(`ALTER TABLE ${name} RENAME TO legacy_sms_${name}`);
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  }

  // Migrate users table CHECK constraint to include 'administrator' if needed
  const userTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
  if (userTableSql && userTableSql.sql && !userTableSql.sql.includes("'administrator'")) {
    db.exec('PRAGMA foreign_keys=OFF;');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        CREATE TABLE users_migrated (id TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('generator','recycler','administrator')), name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, area TEXT NOT NULL, verification_status TEXT NOT NULL, account_status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        INSERT INTO users_migrated SELECT * FROM users;
        DROP TABLE users;
        ALTER TABLE users_migrated RENAME TO users;
      `);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    finally { db.exec('PRAGMA foreign_keys=ON;'); }
  }

  // Migrate recycler_applications table CHECK constraint to include 'suspended' and 'revoked'
  const appTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='recycler_applications'").get();
  if (appTableSql && appTableSql.sql && !appTableSql.sql.includes("'suspended'")) {
    db.exec('PRAGMA foreign_keys=OFF;');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        CREATE TABLE recycler_applications_migrated (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
          business_name TEXT NOT NULL,
          contact_phone TEXT NOT NULL DEFAULT '',
          business_address TEXT NOT NULL DEFAULT '',
          contact_details TEXT NOT NULL DEFAULT '',
          gov_id_type TEXT NOT NULL,
          gov_id_number TEXT NOT NULL,
          gov_id_file TEXT NOT NULL,
          photo_file TEXT NOT NULL,
          licence_type TEXT NOT NULL,
          licence_number TEXT NOT NULL,
          licence_file TEXT NOT NULL,
          area TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','suspended','revoked')),
          admin_user_id TEXT,
          admin_note TEXT,
          reviewed_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        INSERT INTO recycler_applications_migrated (
          id, user_id, business_name, contact_phone, business_address, contact_details,
          gov_id_type, gov_id_number, gov_id_file, photo_file, licence_type, licence_number,
          licence_file, area, status, admin_user_id, admin_note, reviewed_at, created_at, updated_at
        )
        SELECT
          id, user_id, business_name, contact_phone, business_address, contact_details,
          gov_id_type, gov_id_number, gov_id_file, photo_file, licence_type, licence_number,
          licence_file, area, status, admin_user_id, admin_note, reviewed_at, created_at, updated_at
        FROM recycler_applications;
        DROP TABLE recycler_applications;
        ALTER TABLE recycler_applications_migrated RENAME TO recycler_applications;
      `);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    finally { db.exec('PRAGMA foreign_keys=ON;'); }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('generator','recycler','administrator')), name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, area TEXT NOT NULL, verification_status TEXT NOT NULL, account_status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS registrations (id TEXT PRIMARY KEY, role TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, area TEXT NOT NULL, provider_id TEXT, code_hash TEXT, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, sent_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, verified_at INTEGER, user_id TEXT REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS recycler_applications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
      business_name TEXT NOT NULL,
      contact_phone TEXT NOT NULL DEFAULT '',
      business_address TEXT NOT NULL DEFAULT '',
      contact_details TEXT NOT NULL DEFAULT '',
      gov_id_type TEXT NOT NULL,
      gov_id_number TEXT NOT NULL,
      gov_id_file TEXT NOT NULL,
      photo_file TEXT NOT NULL,
      licence_type TEXT NOT NULL,
      licence_number TEXT NOT NULL,
      licence_file TEXT NOT NULL,
      area TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','suspended','revoked')),
      admin_user_id TEXT,
      admin_note TEXT,
      reviewed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS supported_materials (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      recyclable INTEGER NOT NULL DEFAULT 1,
      guidance TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS recycler_material_settings (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      material_id TEXT NOT NULL REFERENCES supported_materials(id),
      accepted INTEGER NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      unit TEXT NOT NULL CHECK(unit IN ('per kilogram','per item','per bag')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(user_id, material_id)
    );
    CREATE TABLE IF NOT EXISTS recycler_availability (
      user_id TEXT PRIMARY KEY REFERENCES users(id),
      availability TEXT NOT NULL CHECK(availability IN ('available','unavailable')),
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS login_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      email TEXT NOT NULL,
      provider_id TEXT,
      code_hash TEXT,
      status TEXT NOT NULL CHECK(status IN ('sent', 'verified', 'expired', 'failed', 'superseded')),
      attempts INTEGER NOT NULL DEFAULT 0,
      sent_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      verified_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS material_intakes (
      id TEXT PRIMARY KEY,
      generator_user_id TEXT NOT NULL REFERENCES users(id),
      intake_method TEXT NOT NULL CHECK(intake_method IN ('manual selection', 'photo upload', 'scan')),
      material_id TEXT REFERENCES supported_materials(id),
      material_name TEXT NOT NULL,
      photo_file TEXT,
      recyclable INTEGER NOT NULL DEFAULT 1,
      guidance_tip TEXT,
      outcome TEXT NOT NULL CHECK(outcome IN ('continued to matching', 'not supported in this pilot')),
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS listings (
      id TEXT PRIMARY KEY,
      generator_user_id TEXT NOT NULL REFERENCES users(id),
      recycler_user_id TEXT NOT NULL REFERENCES users(id),
      material_id TEXT NOT NULL REFERENCES supported_materials(id),
      material_intake_id TEXT REFERENCES material_intakes(id),
      description TEXT,
      photo_file TEXT,
      declared_quantity REAL,
      quantity_unit TEXT,
      location_address TEXT NOT NULL,
      generator_area TEXT NOT NULL,
      preferred_arrangement TEXT NOT NULL CHECK(preferred_arrangement IN ('pickup', 'drop-off')),
      estimated_price REAL,
      price_unit TEXT,
      status TEXT NOT NULL CHECK(status IN ('draft', 'sent to recycler', 'accepted', 'declined', 'handover arranged', 'inspected', 'funded final offer', 'completed', 'rejected', 'offer rejected', 'expired')),
      handover_code TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS recycler_match_results (
      id TEXT PRIMARY KEY,
      generator_user_id TEXT NOT NULL REFERENCES users(id),
      recycler_user_id TEXT NOT NULL REFERENCES users(id),
      material_id TEXT NOT NULL REFERENCES supported_materials(id),
      estimated_price REAL NOT NULL,
      price_unit TEXT NOT NULL,
      matched_area TEXT NOT NULL,
      match_status TEXT NOT NULL CHECK(match_status IN ('shown', 'selected', 'not selected')),
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS listing_responses (
      id TEXT PRIMARY KEY,
      listing_id TEXT NOT NULL UNIQUE REFERENCES listings(id),
      recycler_user_id TEXT NOT NULL REFERENCES users(id),
      response TEXT NOT NULL CHECK(response IN ('accepted', 'declined')),
      decline_reason TEXT,
      agreed_arrangement TEXT CHECK(agreed_arrangement IN ('pickup', 'drop-off')),
      arrangement_note TEXT,
      contacts_shared_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inspections (
      id TEXT PRIMARY KEY,
      listing_id TEXT NOT NULL REFERENCES listings(id),
      recycler_user_id TEXT NOT NULL REFERENCES users(id),
      actual_quantity REAL NOT NULL,
      actual_unit TEXT NOT NULL,
      inspection_note TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS final_offers (
      id TEXT PRIMARY KEY,
      listing_id TEXT NOT NULL REFERENCES listings(id),
      recycler_user_id TEXT NOT NULL REFERENCES users(id),
      generator_user_id TEXT NOT NULL REFERENCES users(id),
      inspection_id TEXT NOT NULL REFERENCES inspections(id),
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'NGN',
      funding_status TEXT NOT NULL CHECK(funding_status IN ('pending', 'funded', 'failed', 'released', 'returned', 'refunded')),
      offer_status TEXT NOT NULL CHECK(offer_status IN ('draft', 'funded and sent', 'accepted', 'rejected', 'expired')),
      sent_at INTEGER,
      expires_at INTEGER,
      decision TEXT CHECK(decision IN ('pending', 'accepted', 'rejected', 'expired')),
      decision_at INTEGER,
      rejection_reason TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS wallet_payments (
      id TEXT PRIMARY KEY,
      final_offer_id TEXT NOT NULL REFERENCES final_offers(id),
      listing_id TEXT NOT NULL REFERENCES listings(id),
      payer_user_id TEXT NOT NULL REFERENCES users(id),
      payee_user_id TEXT REFERENCES users(id),
      payment_type TEXT NOT NULL CHECK(payment_type IN ('recycler funding', 'generator payout', 'funding returned')),
      amount REAL NOT NULL,
      commission_amount REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'NGN',
      provider_name TEXT NOT NULL DEFAULT 'EcoSmart Escrow',
      provider_reference TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('successful', 'failed', 'released', 'reversed', 'returned', 'refunded')),
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS transaction_events (
      id TEXT PRIMARY KEY,
      listing_id TEXT NOT NULL REFERENCES listings(id),
      final_offer_id TEXT REFERENCES final_offers(id),
      event_type TEXT NOT NULL,
      actor_user_id TEXT,
      from_status TEXT,
      to_status TEXT,
      event_note TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      listing_id TEXT NOT NULL REFERENCES listings(id),
      sender_user_id TEXT NOT NULL REFERENCES users(id),
      recipient_user_id TEXT NOT NULL REFERENCES users(id),
      message TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS call_sessions (
      id TEXT PRIMARY KEY,
      listing_id TEXT NOT NULL REFERENCES listings(id),
      caller_user_id TEXT NOT NULL REFERENCES users(id),
      receiver_user_id TEXT NOT NULL REFERENCES users(id),
      status TEXT NOT NULL CHECK(status IN ('ringing', 'connected', 'ended', 'declined', 'missed')),
      started_at INTEGER NOT NULL,
      connected_at INTEGER,
      ended_at INTEGER,
      duration_seconds INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS user_wallets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
      available_balance REAL NOT NULL DEFAULT 0,
      escrow_locked_balance REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'NGN',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      type TEXT NOT NULL CHECK(type IN ('topup', 'escrow_lock', 'escrow_unlock', 'payout_credit', 'withdrawal')),
      amount REAL NOT NULL,
      balance_after REAL NOT NULL,
      listing_id TEXT REFERENCES listings(id),
      reference TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      metadata TEXT,
      status TEXT NOT NULL CHECK(status IN ('successful', 'pending', 'failed')),
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_bank_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
      bank_code TEXT NOT NULL,
      bank_name TEXT NOT NULL,
      account_number TEXT NOT NULL,
      account_name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS registrations_email_sent ON registrations(email, sent_at);
    CREATE INDEX IF NOT EXISTS login_requests_email_sent ON login_requests(email, sent_at);
    CREATE INDEX IF NOT EXISTS material_intakes_user ON material_intakes(generator_user_id, created_at);
    CREATE INDEX IF NOT EXISTS listings_generator ON listings(generator_user_id, created_at);
    CREATE INDEX IF NOT EXISTS listings_recycler ON listings(recycler_user_id, status);
    CREATE INDEX IF NOT EXISTS match_results_gen ON recycler_match_results(generator_user_id, created_at);
    CREATE INDEX IF NOT EXISTS listing_responses_listing ON listing_responses(listing_id);
    CREATE INDEX IF NOT EXISTS listing_responses_recycler ON listing_responses(recycler_user_id);
    CREATE INDEX IF NOT EXISTS inspections_listing ON inspections(listing_id);
    CREATE INDEX IF NOT EXISTS final_offers_listing ON final_offers(listing_id);
    CREATE INDEX IF NOT EXISTS wallet_payments_listing ON wallet_payments(listing_id);
    CREATE INDEX IF NOT EXISTS transaction_events_listing ON transaction_events(listing_id, created_at);
    CREATE INDEX IF NOT EXISTS chat_messages_listing ON chat_messages(listing_id, created_at);
    CREATE INDEX IF NOT EXISTS call_sessions_listing ON call_sessions(listing_id, started_at);
    CREATE INDEX IF NOT EXISTS wallet_transactions_user ON wallet_transactions(user_id, created_at);
    CREATE INDEX IF NOT EXISTS user_bank_accounts_user ON user_bank_accounts(user_id);
  `);

  const appCols = db.prepare('PRAGMA table_info(recycler_applications)').all().map(c => c.name);
  if (appCols.length > 0) {
    if (!appCols.includes('contact_phone')) db.exec("ALTER TABLE recycler_applications ADD COLUMN contact_phone TEXT NOT NULL DEFAULT ''");
    if (!appCols.includes('business_address')) db.exec("ALTER TABLE recycler_applications ADD COLUMN business_address TEXT NOT NULL DEFAULT ''");
  }

  const intakeCols = db.prepare('PRAGMA table_info(material_intakes)').all().map(c => c.name);
  if (intakeCols.length > 0 && !intakeCols.includes('photo_file')) {
    db.exec('ALTER TABLE material_intakes ADD COLUMN photo_file TEXT');
  }

  const listingCols = db.prepare('PRAGMA table_info(listings)').all().map(c => c.name);
  if (listingCols.length > 0 && !listingCols.includes('handover_code')) {
    db.exec('ALTER TABLE listings ADD COLUMN handover_code TEXT');
  }

  const now = Date.now();
  const pilotMaterials = [
    { id: 'cardboard', name: 'Cardboard', guidance: 'Keep clean, dry, and flattened. Remove excessive tape or plastic wrapping.' },
    { id: 'pet_plastic_bottles', name: 'PET plastic bottles', guidance: 'Empty all liquids, rinse lightly, and crush bottles to save space. Caps can remain attached.' },
    { id: 'aluminium', name: 'Aluminium', guidance: 'Clean beverage cans and clean aluminium scraps are accepted. Keep separate from other metals.' },
    { id: 'brass', name: 'Brass', guidance: 'Valuable non-ferrous alloy (valves, plumbing fixtures, ornamental items). Keep clean of attachments.' },
    { id: 'glass', name: 'Glass', guidance: 'Rinse bottles and jars. Separate by colour if possible. Avoid broken mirror or window glass.' }
  ];
  for (const m of pilotMaterials) {
    db.prepare('INSERT OR IGNORE INTO supported_materials (id, name, active, recyclable, guidance, created_at) VALUES (?, ?, 1, 1, ?, ?)').run(m.id, m.name, m.guidance, now);
  }

  return db;
}

export function verificationKey(dbPath) {
  if (dbPath === ':memory:') return randomBytes(32);
  const path = join(dirname(dbPath), 'verification.key');
  try { writeFileSync(path, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const key = readFileSync(path);
  if (key.length !== 32) throw new Error('Invalid verification.key: restore the original 32-byte key.');
  return key;
}
