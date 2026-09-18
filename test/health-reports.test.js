import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from '../server.js';
import { randomUUID } from 'node:crypto';
import { adminRequest } from '../test-support/admin.js';

async function fixture(t, options = {}) {
  let time = Date.now();
  const provider = {
    configured: true,
    send: async () => 'test_id',
    sendNotification: async () => 'test_notif'
  };
  const app = createApp({ demoPayments: true, dbPath: ':memory:', now: () => time, provider, origin: 'http://localhost:3000', ...options });
  await new Promise(res => app.server.listen(0, '127.0.0.1', res));
  t.after(async () => { await new Promise(res => app.server.close(res)); app.db.close(); });
  return { app };
}

test('MVP Health: recycler suspension and revocation are stored distinctly with accurate stats', async t => {
  const { app } = await fixture(t);
  const now = Date.now();

  // Create 3 recycler accounts with applications
  const rec1Id = randomUUID();
  const rec2Id = randomUUID();
  const rec3Id = randomUUID();
  app.db.prepare("INSERT INTO users VALUES (?, 'recycler', 'Recycler 1', 'rec1@test.ng', 'Lagos', 'verified', 'active', ?, ?)").run(rec1Id, now, now);
  app.db.prepare("INSERT INTO users VALUES (?, 'recycler', 'Recycler 2', 'rec2@test.ng', 'Lagos', 'verified', 'active', ?, ?)").run(rec2Id, now, now);
  app.db.prepare("INSERT INTO users VALUES (?, 'recycler', 'Recycler 3', 'rec3@test.ng', 'Lagos', 'verified', 'active', ?, ?)").run(rec3Id, now, now);

  const app1Id = randomUUID();
  const app2Id = randomUUID();
  const app3Id = randomUUID();

  app.db.prepare(`
    INSERT INTO recycler_applications (id, user_id, business_name, contact_phone, business_address, contact_details, gov_id_type, gov_id_number, gov_id_file, photo_file, licence_type, licence_number, licence_file, area, status, created_at, updated_at)
    VALUES (?, ?, 'Recycler 1 Scrap', '0801', 'Yard 1', '', 'NIN', '123', 'f', 'p', 'CAC', '123', 'l', 'Lagos', 'approved', ?, ?)
  `).run(app1Id, rec1Id, now, now);

  app.db.prepare(`
    INSERT INTO recycler_applications (id, user_id, business_name, contact_phone, business_address, contact_details, gov_id_type, gov_id_number, gov_id_file, photo_file, licence_type, licence_number, licence_file, area, status, created_at, updated_at)
    VALUES (?, ?, 'Recycler 2 Scrap', '0802', 'Yard 2', '', 'NIN', '456', 'f', 'p', 'CAC', '456', 'l', 'Lagos', 'approved', ?, ?)
  `).run(app2Id, rec2Id, now, now);

  app.db.prepare(`
    INSERT INTO recycler_applications (id, user_id, business_name, contact_phone, business_address, contact_details, gov_id_type, gov_id_number, gov_id_file, photo_file, licence_type, licence_number, licence_file, area, status, created_at, updated_at)
    VALUES (?, ?, 'Recycler 3 Scrap', '0803', 'Yard 3', '', 'NIN', '789', 'f', 'p', 'CAC', '789', 'l', 'Lagos', 'pending', ?, ?)
  `).run(app3Id, rec3Id, now, now);

  // Suspend Recycler 1
  const suspendRes = await adminRequest(app, '/api/admin/review-application', {
    applicationId: app1Id,
    decision: 'suspended',
    note: 'Temporary compliance check'
  });
  assert.equal(suspendRes.status, 200);
  assert.equal(suspendRes.data.application.status, 'suspended');

  // Verify in database that application status is stored as 'suspended', NOT 'rejected'
  const dbApp1 = app.db.prepare('SELECT status FROM recycler_applications WHERE id=?').get(app1Id);
  assert.equal(dbApp1.status, 'suspended');

  // Revoke Recycler 2
  const revokeRes = await adminRequest(app, '/api/admin/review-application', {
    applicationId: app2Id,
    decision: 'revoked',
    note: 'Licence expired'
  });
  assert.equal(revokeRes.status, 200);
  assert.equal(revokeRes.data.application.status, 'revoked');

  // Verify in database that application status is stored as 'revoked', NOT 'rejected'
  const dbApp2 = app.db.prepare('SELECT status FROM recycler_applications WHERE id=?').get(app2Id);
  assert.equal(dbApp2.status, 'revoked');

  // Check admin applications stats
  const appsRes = await adminRequest(app, '/api/admin/applications', {});
  assert.equal(appsRes.status, 200);
  assert.equal(appsRes.data.stats.suspended, 1);
  assert.equal(appsRes.data.stats.revoked, 1);
  assert.equal(appsRes.data.stats.rejected, 0);
  assert.equal(appsRes.data.stats.pending, 1);
  assert.equal(appsRes.data.stats.approved, 0);
});

test('MVP Health: /api/state returns paymentsActive flag matching environment', async t => {
  const { app: appWithDemo } = await fixture(t, { demoPayments: true });
  const res1 = await fetch(`http://127.0.0.1:${appWithDemo.server.address().port}/api/state`, {
    headers: { Origin: 'http://localhost:3000' }
  });
  const data1 = await res1.json();
  assert.equal(data1.paymentsActive, true);

  const { app: appWithoutDemo } = await fixture(t, { demoPayments: false });
  const res2 = await fetch(`http://127.0.0.1:${appWithoutDemo.server.address().port}/api/state`, {
    headers: { Origin: 'http://localhost:3000' }
  });
  const data2 = await res2.json();
  assert.equal(data2.paymentsActive, false);
});

test('MVP Health: HTML structure places incoming requests before pricing settings, and includes accessible modal roles', async () => {
  const html = readFileSync(resolve('public/index.html'), 'utf-8');

  // Verify requests come before materials section
  const requestsIndex = html.indexOf('class="incoming-requests-section"');
  const materialsIndex = html.indexOf('class="materials-section"');
  assert.ok(requestsIndex > 0, 'incoming-requests-section exists');
  assert.ok(materialsIndex > 0, 'materials-section exists');
  assert.ok(requestsIndex < materialsIndex, 'incoming-requests-section is placed above materials-section');

  // Verify accessible modal attributes
  assert.ok(html.includes('id="wallet-topup-modal" class="wallet-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="topup-modal-title"'));
  assert.ok(html.includes('id="wallet-bank-modal" class="wallet-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="bank-modal-title"'));
  assert.ok(html.includes('id="wallet-withdraw-modal" class="wallet-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="withdraw-modal-title"'));

  // Verify bank badge clarifies unverified status
  assert.ok(html.includes('unverified — settlements processed manually'));

  // Verify effective unit rate display in Screen 7
  assert.ok(html.includes('id="screen7-breakdown-rate"'));
  assert.ok(html.includes('id="screen7-verified-rate"'));
});

test('Origin resolution: resolvePublicOrigin prioritizes APP_ORIGIN, RAILWAY_PUBLIC_DOMAIN, and request headers over localhost', async () => {
  const { resolvePublicOrigin } = await import('../server.js');

  const oldAppOrigin = process.env.APP_ORIGIN;
  const oldRailwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN;

  try {
    // 1. APP_ORIGIN without scheme and with trailing slash
    process.env.APP_ORIGIN = 'ace-ecosmart-production.up.railway.app///';
    delete process.env.RAILWAY_PUBLIC_DOMAIN;
    assert.equal(resolvePublicOrigin(null, 'http://localhost:3000'), 'https://ace-ecosmart-production.up.railway.app');

    // 2. APP_ORIGIN with https scheme
    process.env.APP_ORIGIN = 'https://custom-domain.com/';
    assert.equal(resolvePublicOrigin(null, 'http://localhost:3000'), 'https://custom-domain.com');

    // 3. RAILWAY_PUBLIC_DOMAIN fallback when APP_ORIGIN is absent
    delete process.env.APP_ORIGIN;
    process.env.RAILWAY_PUBLIC_DOMAIN = 'ace-app.railway.app';
    assert.equal(resolvePublicOrigin(null, 'http://localhost:3000'), 'https://ace-app.railway.app');

    // 4. Dynamic request header fallback when env vars are absent
    delete process.env.RAILWAY_PUBLIC_DOMAIN;
    const mockReq = {
      headers: {
        'x-forwarded-host': 'ace-ecosmart.up.railway.app',
        'x-forwarded-proto': 'https'
      }
    };
    assert.equal(resolvePublicOrigin(mockReq, 'http://localhost:3000'), 'https://ace-ecosmart.up.railway.app');

    // 5. Localhost fallback when headers are localhost
    const localReq = {
      headers: {
        'host': 'localhost:3000'
      }
    };
    assert.equal(resolvePublicOrigin(localReq, 'http://localhost:3000'), 'http://localhost:3000');
  } finally {
    if (oldAppOrigin !== undefined) process.env.APP_ORIGIN = oldAppOrigin; else delete process.env.APP_ORIGIN;
    if (oldRailwayDomain !== undefined) process.env.RAILWAY_PUBLIC_DOMAIN = oldRailwayDomain; else delete process.env.RAILWAY_PUBLIC_DOMAIN;
  }
});

test('Notification email links use public origin from request headers when accessed via proxy', async t => {
  let sentNotifications = [];
  const provider = {
    configured: true,
    send: async () => 'code_123',
    sendNotification: async (email, subject, text) => {
      sentNotifications.push({ email, subject, text });
      return true;
    }
  };

  const { app } = await fixture(t, { provider, origin: 'http://localhost:3000' });
  const now = Date.now();

  // Create generator and recycler
  const genId = randomUUID();
  const recId = randomUUID();
  app.db.prepare("INSERT INTO users VALUES (?, 'generator', 'Maryam Testing', 'maryam@test.ng', 'Ikeja', 'verified', 'active', ?, ?)").run(genId, now, now);
  app.db.prepare("INSERT INTO users VALUES (?, 'recycler', 'Ecosmart Test', 'recycler@test.ng', 'Ikeja', 'verified', 'active', ?, ?)").run(recId, now, now);

  app.db.prepare(`
    INSERT INTO recycler_applications (id, user_id, business_name, contact_phone, business_address, contact_details, gov_id_type, gov_id_number, gov_id_file, photo_file, licence_type, licence_number, licence_file, area, status, created_at, updated_at)
    VALUES (?, ?, 'Ecosmart Test Scrap', '08012345678', 'Plot 4 Ikeja', '', 'NIN', '1234', 'f', 'p', 'CAC', '1234', 'l', 'Ikeja', 'approved', ?, ?)
  `).run(randomUUID(), recId, now, now);

  const sessionId = randomUUID();
  const { createHash } = await import('node:crypto');
  const sessionHash = createHash('sha256').update(sessionId).digest('hex');
  app.db.prepare("INSERT INTO sessions VALUES (?, ?, ?)").run(sessionHash, recId, now + 86400000);

  // Material and listing
  const mat = app.db.prepare('SELECT id FROM supported_materials LIMIT 1').get();
  const listingId = randomUUID();
  app.db.prepare(`
    INSERT INTO listings (id, generator_user_id, recycler_user_id, material_id, declared_quantity, quantity_unit, location_address, generator_area, preferred_arrangement, estimated_price, price_unit, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 50, 'kg', 'Ikeja', 'Ikeja', 'drop-off', 5000, 'per kg', 'sent to recycler', ?, ?)
  `).run(listingId, genId, recId, mat.id, now, now);

  // Recycler responds via proxy with public host
  const port = app.server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/recycler/listings/respond`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `eco_session=${sessionId}`,
      'Origin': 'https://ace-ecosmart-production.up.railway.app',
      'Host': '127.0.0.1',
      'x-forwarded-host': 'ace-ecosmart-production.up.railway.app',
      'x-forwarded-proto': 'https'
    },
    body: JSON.stringify({
      listingId,
      decision: 'accepted',
      agreedArrangement: 'dropoff',
      arrangementNote: 'Drop off at our Ikeja yard'
    })
  });

  assert.equal(res.status, 200);
  assert.equal(sentNotifications.length, 1);
  assert.equal(sentNotifications[0].email, 'maryam@test.ng');
  // Confirm email text contains the public URL and NOT localhost:3000
  assert.ok(sentNotifications[0].text.includes('https://ace-ecosmart-production.up.railway.app'), `Expected email to contain public URL, got: ${sentNotifications[0].text}`);
  assert.ok(!sentNotifications[0].text.includes('localhost:3000'), `Email should NOT contain localhost:3000: ${sentNotifications[0].text}`);
});
