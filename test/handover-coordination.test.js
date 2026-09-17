import { adminRequest, seedWallet } from '../test-support/admin.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';
import { openStorage } from '../storage.js';

const generatorDetails = { role: 'generator', name: 'Generator User', email: 'gen@ecosmart.ng', area: 'Ikeja, Lagos' };
const recyclerDetails = { role: 'recycler', name: 'Recycler Boss', email: 'recycler@ecosmart.ng', area: 'Ikeja, Lagos' };
const otherRecyclerDetails = { role: 'recycler', name: 'Other Recycler', email: 'other@ecosmart.ng', area: 'Ikeja, Lagos' };

async function fixture(t, options = {}) {
  let time = Date.now();
  const messages = [];
  const provider = { configured: true, send: async (email, code) => { messages.push({ email, code }); return 'email_test'; }, ...options.provider };
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

  return { ...app, makeClient, messages, advance: ms => time += ms };
}

async function setupUsersAndListing(env) {
  const genClient = env.makeClient();
  const recClient = env.makeClient();

  const genRes = await genClient.registerAndVerify(generatorDetails);
  const recRes = await recClient.registerAndVerify(recyclerDetails);

  const appRes = await recClient.request('/api/recycler/application', {
    businessName: 'Ikeja Clean Materials Ltd',
    contactPhone: '+234 802 000 1111',
    businessAddress: '15 Recovery Way, Industrial Area, Ikeja',
    govIdType: 'National Identity Number (NIN)',
    govIdNumber: '12345678901',
    govIdFile: 'data:image/png;base64,govid',
    photoFile: 'data:image/png;base64,photo',
    licenceType: 'CAC Business Registration',
    licenceNumber: 'RC-123456',
    licenceFile: 'data:image/png;base64,lic',
    area: 'Ikeja, Lagos'
  });

  await adminRequest(env, '/api/admin/review-application', {
    applicationId: appRes.data.application.id,
    decision: 'approved'
  });

  await recClient.request('/api/recycler/settings', {
    settings: [
      { materialId: 'cardboard', accepted: true, price: 160, unit: 'per kilogram' }
    ],
    availability: 'available'
  });

  const listingRes = await genClient.request('/api/generator/listings', {
    recyclerId: recRes.data.user.id,
    materialId: 'cardboard',
    declaredQuantity: 30,
    quantityUnit: 'kg',
    locationAddress: 'Plot 4, Allen Ave, Ikeja',
    preferredArrangement: 'pickup',
    description: '30kg clean flattened cartons'
  });

  return { genClient, recClient, listing: listingRes.data.listing, genUser: genRes.data.user, recUser: recRes.data.user };
}

test('Recycler accepts listing with arrangement note -> status becomes accepted and mutual contact details are shared', async t => {
  const env = await fixture(t);
  const { genClient, recClient, listing } = await setupUsersAndListing(env);

  // 1. Initial State: details before acceptance hide recycler phone & yard address
  const initialDetails = await genClient.request('/api/listings/details', { listingId: listing.id });
  assert.equal(initialDetails.status, 200);
  assert.equal(initialDetails.data.listing.status, 'sent to recycler');
  assert.equal(initialDetails.data.contactsShared, false);
  assert.equal(initialDetails.data.listing.recycler_phone, null);
  assert.equal(initialDetails.data.listing.recycler_yard_address, null);

  // 2. Recycler responds with acceptance
  const respondRes = await recClient.request('/api/recycler/listings/respond', {
    listingId: listing.id,
    decision: 'accepted',
    agreedArrangement: 'pickup',
    arrangementNote: 'Truck driver arriving tomorrow at 10:30 AM'
  });

  assert.equal(respondRes.status, 200);
  assert.equal(respondRes.data.listing.status, 'accepted');
  assert.equal(respondRes.data.response.response, 'accepted');
  assert.equal(respondRes.data.response.agreed_arrangement, 'pickup');
  assert.equal(respondRes.data.response.arrangement_note, 'Truck driver arriving tomorrow at 10:30 AM');
  assert.ok(respondRes.data.response.contacts_shared_at);

  // 3. Generator views listing details after acceptance -> contact details now unlocked
  const genView = await genClient.request('/api/listings/details', { listingId: listing.id });
  assert.equal(genView.status, 200);
  assert.equal(genView.data.listing.status, 'accepted');
  assert.equal(genView.data.contactsShared, true);
  assert.equal(genView.data.listing.recycler_phone, '+234 802 000 1111');
  assert.equal(genView.data.listing.recycler_yard_address, '15 Recovery Way, Industrial Area, Ikeja');

  // 4. GET /api/state reflects accepted listing and responses
  const genState = await genClient.request('/api/state');
  const genL = genState.data.listings.find(l => l.id === listing.id);
  assert.equal(genL.status, 'accepted');
  assert.equal(genL.recycler_phone, '+234 802 000 1111');
  assert.equal(genL.response_status, 'accepted');

  const recState = await recClient.request('/api/state');
  const recReq = recState.data.incomingRequests.find(l => l.id === listing.id);
  assert.equal(recReq.status, 'accepted');
  assert.equal(recReq.response_status, 'accepted');
});

test('Recycler declines listing -> status becomes declined and decline reason is recorded', async t => {
  const env = await fixture(t);
  const { genClient, recClient, listing } = await setupUsersAndListing(env);

  const declineRes = await recClient.request('/api/recycler/listings/respond', {
    listingId: listing.id,
    decision: 'declined',
    declineReason: 'Currently reached daily warehouse capacity for cardboard'
  });

  assert.equal(declineRes.status, 200);
  assert.equal(declineRes.data.listing.status, 'declined');
  assert.equal(declineRes.data.response.response, 'declined');
  assert.equal(declineRes.data.response.decline_reason, 'Currently reached daily warehouse capacity for cardboard');

  // Generator checks details
  const genView = await genClient.request('/api/listings/details', { listingId: listing.id });
  assert.equal(genView.status, 200);
  assert.equal(genView.data.listing.status, 'declined');
  assert.equal(genView.data.contactsShared, false);
  assert.equal(genView.data.response.decline_reason, 'Currently reached daily warehouse capacity for cardboard');
});

test('Authorization and ownership guards for responses and handover', async t => {
  const env = await fixture(t);
  const { genClient, recClient, listing } = await setupUsersAndListing(env);
  const otherClient = env.makeClient();
  await otherClient.registerAndVerify(otherRecyclerDetails);

  // 1. Unassigned recycler cannot respond
  const unauthRes = await otherClient.request('/api/recycler/listings/respond', {
    listingId: listing.id,
    decision: 'accepted'
  });
  assert.equal(unauthRes.status, 403);

  // 2. Generator cannot call recycler respond endpoint
  const genRespond = await genClient.request('/api/recycler/listings/respond', {
    listingId: listing.id,
    decision: 'accepted'
  });
  assert.equal(genRespond.status, 401);

  // 3. Handover complete requires accepted state
  const earlyHandover = await recClient.request('/api/recycler/listings/handover-complete', {
    listingId: listing.id
  });
  assert.equal(earlyHandover.status, 400);

  // 4. Accept listing then complete handover
  await recClient.request('/api/recycler/listings/respond', {
    listingId: listing.id,
    decision: 'accepted',
    agreedArrangement: 'pickup'
  });

  const completeRes = await recClient.request('/api/recycler/listings/handover-complete', {
    listingId: listing.id
  });
  assert.equal(completeRes.status, 200);
  assert.equal(completeRes.data.listing.status, 'handover arranged');
});

test('Listing responses and contact coordination persist across database restarts', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ecosmart-handover-test-'));
  const dbPath = join(dir, 'test.db');
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  let listingId = '';

  // Instance 1: Create, send, and accept listing
  {
    let capturedCode = '';
    const app = createApp({ demoPayments: true,
      dbPath,
      origin: 'http://localhost:3000',
      provider: { configured: true, send: async (email, code) => { capturedCode = code; return 'ok'; } }
    });
    await new Promise(r => app.server.listen(0, '127.0.0.1', r));

    const genClient = {
      cookie: '',
      async request(path, data) {
        const res = await fetch(`http://127.0.0.1:${app.server.address().port}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', Cookie: this.cookie },
          body: JSON.stringify(data)
        });
        const jar = Object.fromEntries(this.cookie.split('; ').filter(Boolean).map(x => x.split('=')));
        for (const item of res.headers.getSetCookie()) {
          const [k, v] = item.split(';')[0].split('=');
          jar[k] = v;
        }
        this.cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
        return { status: res.status, data: await res.json() };
      }
    };

    const recClient = {
      cookie: '',
      async request(path, data) {
        const res = await fetch(`http://127.0.0.1:${app.server.address().port}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', Cookie: this.cookie },
          body: JSON.stringify(data)
        });
        const jar = Object.fromEntries(this.cookie.split('; ').filter(Boolean).map(x => x.split('=')));
        for (const item of res.headers.getSetCookie()) {
          const [k, v] = item.split(';')[0].split('=');
          jar[k] = v;
        }
        this.cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
        return { status: res.status, data: await res.json() };
      }
    };

    // Register Gen
    await genClient.request('/api/register', generatorDetails);
    const genReg = await genClient.request('/api/verify', { code: capturedCode });

    // Register Rec
    await recClient.request('/api/register', recyclerDetails);
    const recReg = await recClient.request('/api/verify', { code: capturedCode });

    const appRes = await recClient.request('/api/recycler/application', {
      businessName: 'Persist Cleaners Ltd',
      contactPhone: '+234 809 999 8888',
      businessAddress: '44 Persistent Way, Ikeja',
      govIdType: 'National Identity Number (NIN)',
      govIdNumber: '99998888777',
      govIdFile: 'data:image/png;base64,id',
      photoFile: 'data:image/png;base64,photo',
      licenceType: 'CAC Business Registration',
      licenceNumber: 'RC-999999',
      licenceFile: 'data:image/png;base64,lic',
      area: 'Ikeja, Lagos'
    });

    await adminRequest(app, '/api/admin/review-application', {
      applicationId: appRes.data.application.id,
      decision: 'approved'
    });

    await recClient.request('/api/recycler/settings', {
      settings: [{ materialId: 'cardboard', accepted: true, price: 175, unit: 'per kilogram' }],
      availability: 'available'
    });

    const lRes = await genClient.request('/api/generator/listings', {
      recyclerId: recReg.data.user.id,
      materialId: 'cardboard',
      declaredQuantity: 50,
      quantityUnit: 'kg',
      locationAddress: '20 Persistence St, Ikeja',
      preferredArrangement: 'pickup'
    });
    listingId = lRes.data.listing.id;

    await recClient.request('/api/recycler/listings/respond', {
      listingId,
      decision: 'accepted',
      agreedArrangement: 'pickup',
      arrangementNote: 'Van arrives Friday 9am'
    });

    await new Promise(r => app.server.close(r));
    app.db.close();
  }

  // Instance 2: Verify in reopened database
  {
    const storage = openStorage(dbPath);
    const lRow = storage.prepare('SELECT * FROM listings WHERE id=?').get(listingId);
    assert.equal(lRow.status, 'accepted');

    const respRow = storage.prepare('SELECT * FROM listing_responses WHERE listing_id=?').get(listingId);
    assert.equal(respRow.response, 'accepted');
    assert.equal(respRow.agreed_arrangement, 'pickup');
    assert.equal(respRow.arrangement_note, 'Van arrives Friday 9am');
    assert.ok(respRow.contacts_shared_at > 0);
    storage.close();
  }
});
