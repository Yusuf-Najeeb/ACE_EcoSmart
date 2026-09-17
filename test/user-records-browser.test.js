import { adminRequest, seedWallet } from '../test-support/admin.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';

const generatorDetails = { role: 'generator', name: 'Alhaji Generator', email: 'alhaji@ecosmart.ng', area: 'Ikeja, Lagos' };
const recyclerDetails = { role: 'recycler', name: 'Ikeja Aggregators', email: 'ikeja-rec@ecosmart.ng', area: 'Ikeja, Lagos' };
const otherUserDetails = { role: 'generator', name: 'Third Party User', email: 'thirdparty@ecosmart.ng', area: 'Surulere, Lagos' };

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

async function setupCompletedTransaction(env) {
  const genClient = env.makeClient();
  const recClient = env.makeClient();

  const genRes = await genClient.registerAndVerify(generatorDetails);
  const recRes = await recClient.registerAndVerify(recyclerDetails);
  seedWallet(env, recRes.data.user.id);

  const appRes = await recClient.request('/api/recycler/application', {
    businessName: 'Ikeja Eco Materials Ltd',
    contactPhone: '+234 802 555 1234',
    businessAddress: '44 Commercial Road, Ikeja',
    govIdType: 'National Identity Number (NIN)',
    govIdNumber: '55555555555',
    govIdFile: 'data:image/png;base64,govid',
    photoFile: 'data:image/png;base64,photo',
    licenceType: 'CAC Business Registration',
    licenceNumber: 'RC-555555',
    licenceFile: 'data:image/png;base64,lic',
    area: 'Ikeja, Lagos'
  });

  await adminRequest(env, '/api/admin/review-application', {
    applicationId: appRes.data.application.id,
    decision: 'approved'
  });

  await recClient.request('/api/recycler/settings', {
    settings: [{ materialId: 'cardboard', accepted: true, price: 150, unit: 'per kilogram' }]
  });

  const listRes = await genClient.request('/api/generator/listings', {
    recyclerId: recRes.data.user.id,
    materialId: 'cardboard',
    description: 'Clean flattened boxes',
    declaredQuantity: 40,
    quantityUnit: 'kg',
    locationAddress: 'Ikeja Industrial Zone',
    preferredArrangement: 'pickup'
  });
  const listingId = listRes.data.listing.id;

  await recClient.request('/api/recycler/listings/respond', {
    listingId,
    decision: 'accepted',
    agreedArrangement: 'pickup',
    arrangementNote: 'Driver arriving at 11 AM'
  });

  await recClient.request('/api/recycler/inspection/submit-offer', {
    listingId,
    actualQuantity: 42.5,
    quantityUnit: 'kg',
    inspectionNotes: 'Weighed 42.5kg dry cardboard',
    amount: 6375
  });

  await genClient.request('/api/generator/offer/decision', {
    listingId,
    decision: 'accept'
  });

  return { genClient, recClient, genUser: genRes.data.user, recUser: recRes.data.user, listingId };
}

test('User records browser: generator metrics, completed transactions, and payment references', async t => {
  const env = await fixture(t);
  const { genClient, listingId } = await setupCompletedTransaction(env);

  const res = await genClient.request('/api/user/records', {});
  assert.equal(res.status, 200);
  assert.equal(res.data.records.length, 1);
  assert.equal(res.data.stats.totalListings, 1);
  assert.equal(res.data.stats.completed, 1);
  assert.equal(res.data.stats.active, 0);
  assert.equal(res.data.stats.totalVolumeKg, 42.5);
  assert.equal(res.data.stats.totalAmount, 6375);
  assert.equal(res.data.stats.role, 'generator');

  const rec = res.data.records[0];
  assert.equal(rec.id, listingId);
  assert.equal(rec.material_name, 'Cardboard');
  assert.equal(rec.status, 'completed');
  assert.equal(rec.final_offer_amount, 6375);
  assert.ok(rec.payment_ref.startsWith('PAYOUT-'));
});

test('User records browser: recycler metrics, purchases total, and status filtering', async t => {
  const env = await fixture(t);
  const { recClient, listingId } = await setupCompletedTransaction(env);

  // 1. Recycler overview
  const res = await recClient.request('/api/user/records', {});
  assert.equal(res.status, 200);
  assert.equal(res.data.records.length, 1);
  assert.equal(res.data.stats.totalListings, 1);
  assert.equal(res.data.stats.completed, 1);
  assert.equal(res.data.stats.totalAmount, 6375);
  assert.equal(res.data.stats.role, 'recycler');

  // 2. Status filter: completed
  const completedRes = await recClient.request('/api/user/records', { status: 'completed' });
  assert.equal(completedRes.data.records.length, 1);

  // 3. Status filter: in_progress
  const inProgRes = await recClient.request('/api/user/records', { status: 'in_progress' });
  assert.equal(inProgRes.data.records.length, 0);

  // 4. Query search
  const queryMatch = await recClient.request('/api/user/records', { query: 'Cardboard' });
  assert.equal(queryMatch.data.records.length, 1);

  const queryNoMatch = await recClient.request('/api/user/records', { query: 'Aluminium' });
  assert.equal(queryNoMatch.data.records.length, 0);
});

test('User record details API: full lifecycle milestone audit trail & privacy guards', async t => {
  const env = await fixture(t);
  const { genClient, recClient, listingId } = await setupCompletedTransaction(env);
  const otherClient = env.makeClient();
  await otherClient.registerAndVerify(otherUserDetails);

  // 1. Generator retrieves full details & event trail
  const genDetails = await genClient.request('/api/user/record-details', { listingId });
  assert.equal(genDetails.status, 200);
  assert.equal(genDetails.data.listing.id, listingId);
  assert.equal(genDetails.data.inspection.actual_quantity, 42.5);
  assert.equal(genDetails.data.finalOffer.amount, 6375);
  assert.ok(genDetails.data.payment.provider_reference.startsWith('PAYOUT-'));
  assert.ok(genDetails.data.events.length >= 4);

  // Check event sequence
  const eventTypes = genDetails.data.events.map(e => e.event_type);
  assert.ok(eventTypes.includes('listing_created'));
  assert.ok(eventTypes.includes('response_accepted'));
  assert.ok(eventTypes.includes('inspection_recorded'));
  assert.ok(eventTypes.includes('offer_funded_and_sent'));
  assert.ok(eventTypes.includes('offer_accepted'));
  assert.ok(eventTypes.includes('payout_released'));

  // 2. Recycler retrieves full details
  const recDetails = await recClient.request('/api/user/record-details', { listingId });
  assert.equal(recDetails.status, 200);
  assert.equal(recDetails.data.listing.id, listingId);

  // 3. Unauthorized third party is blocked (403 Forbidden)
  const deniedDetails = await otherClient.request('/api/user/record-details', { listingId });
  assert.equal(deniedDetails.status, 403);
});

test('User records browser: persistence across database restart', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ecosmart-user-records-'));
  const dbPath = join(dir, 'test.sqlite');
  let time = Date.now();
  const messages = [];

  const provider = {
    configured: true,
    send: async (email, code) => { messages.push({ email, code }); return 'email_test'; },
    sendNotification: async () => 'notif_test'
  };

  try {
    let savedListingId = '';
    // 1. First session: conduct transaction
    {
      const app = createApp({ demoPayments: true, dbPath, now: () => time, provider, origin: 'http://localhost:3000' });
      await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
      const port = app.server.address().port;

      function makeCl() {
        let cookie = '';
        async function req(path, data) {
          const response = await fetch(`http://127.0.0.1:${port}${path}`, {
            method: data === undefined ? 'GET' : 'POST',
            headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json', Cookie: cookie },
            body: data === undefined ? undefined : JSON.stringify(data)
          });
          const jar = Object.fromEntries(cookie.split('; ').filter(Boolean).map(x => x.split('=')));
          for (const item of response.headers.getSetCookie()) {
            const [key, value] = item.split(';')[0].split('=');
            jar[key] = value;
          }
          cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
          return { status: response.status, data: await response.json() };
        }
        return req;
      }

      const genReq = makeCl();
      const recReq = makeCl();

      await genReq('/api/register', generatorDetails);
      await genReq('/api/verify', { code: messages.at(-1)?.code });

      await recReq('/api/register', recyclerDetails);
      await recReq('/api/verify', { code: messages.at(-1)?.code });

      const appRes = await recReq('/api/recycler/application', {
        businessName: 'Persisted Records Recycler',
        contactPhone: '+234 802 333 4444',
        businessAddress: '10 Ikeja Rd',
        govIdType: 'National Identity Number (NIN)',
        govIdNumber: '33333333333',
        govIdFile: 'data:image/png;base64,govid',
        photoFile: 'data:image/png;base64,photo',
        licenceType: 'CAC Business Registration',
        licenceNumber: 'RC-333333',
        licenceFile: 'data:image/png;base64,lic',
        area: 'Ikeja, Lagos'
      });

      await adminRequest(app, '/api/admin/review-application', {
        applicationId: appRes.data.application.id,
        decision: 'approved'
      });

      await recReq('/api/recycler/settings', {
        settings: [{ materialId: 'brass', accepted: true, price: 2000, unit: 'per kilogram' }]
      });

      const listRes = await genReq('/api/generator/listings', {
        recyclerId: (await recReq('/api/state')).data.user.id,
        materialId: 'brass',
        declaredQuantity: 10,
        quantityUnit: 'kg',
        locationAddress: 'Ikeja Plaza',
        preferredArrangement: 'drop-off',
        description: 'Brass pipes'
      });
      savedListingId = listRes.data.listing.id;

      await new Promise(resolve => app.server.close(resolve));
      app.db.close();
    }

    // 2. Second session: reload from disk and verify user records and audit details
    {
      const app = createApp({ demoPayments: true, dbPath, now: () => time, provider, origin: 'http://localhost:3000' });
      await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
      const port = app.server.address().port;

      function makeCl() {
        let cookie = '';
        async function req(path, data) {
          const response = await fetch(`http://127.0.0.1:${port}${path}`, {
            method: data === undefined ? 'GET' : 'POST',
            headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json', Cookie: cookie },
            body: data === undefined ? undefined : JSON.stringify(data)
          });
          const jar = Object.fromEntries(cookie.split('; ').filter(Boolean).map(x => x.split('=')));
          for (const item of response.headers.getSetCookie()) {
            const [key, value] = item.split(';')[0].split('=');
            jar[key] = value;
          }
          cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
          return { status: response.status, data: await response.json() };
        }
        return req;
      }

      const genReq = makeCl();
      await genReq('/api/login/request', { email: generatorDetails.email });
      await genReq('/api/login/verify', { code: messages.at(-1)?.code });

      const recordsRes = await genReq('/api/user/records', {});
      assert.equal(recordsRes.status, 200);
      assert.equal(recordsRes.data.records.length, 1);
      assert.equal(recordsRes.data.records[0].id, savedListingId);
      assert.equal(recordsRes.data.records[0].material_id, 'brass');

      const detailsRes = await genReq('/api/user/record-details', { listingId: savedListingId });
      assert.equal(detailsRes.status, 200);
      assert.equal(detailsRes.data.listing.material_id, 'brass');
      assert.ok(detailsRes.data.events.length >= 1);

      await new Promise(resolve => app.server.close(resolve));
      app.db.close();
    }
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
});
