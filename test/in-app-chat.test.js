import { adminRequest, seedWallet } from '../test-support/admin.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';
import { openStorage } from '../storage.js';

const generatorDetails = { role: 'generator', name: 'Generator Najeeb', email: 'gen-chat@ecosmart.ng', area: 'Ikeja, Lagos' };
const recyclerDetails = { role: 'recycler', name: 'RecyclePoint Hub', email: 'rec-chat@ecosmart.ng', area: 'Ikeja, Lagos' };
const thirdPartyDetails = { role: 'generator', name: 'Intruder User', email: 'intruder@ecosmart.ng', area: 'Lekki, Lagos' };

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

async function setupAcceptedListing(env) {
  const genClient = env.makeClient();
  const recClient = env.makeClient();

  const genRes = await genClient.registerAndVerify(generatorDetails);
  const recRes = await recClient.registerAndVerify(recyclerDetails);

  const appRes = await recClient.request('/api/recycler/application', {
    businessName: 'RecyclePoint Hub Ltd',
    contactPhone: '+234 803 123 4567',
    businessAddress: '10 Scrap Yard Rd, Ikeja',
    govIdType: 'National Identity Number (NIN)',
    govIdNumber: '11223344556',
    govIdFile: 'data:image/png;base64,govid',
    photoFile: 'data:image/png;base64,photo',
    licenceType: 'CAC Business Registration',
    licenceNumber: 'RC-998877',
    licenceFile: 'data:image/png;base64,lic',
    area: 'Ikeja, Lagos'
  });

  await adminRequest(env, '/api/admin/review-application', {
    applicationId: appRes.data.application.id,
    decision: 'approved'
  });

  await recClient.request('/api/recycler/settings', {
    settings: [
      { materialId: 'cardboard', accepted: true, price: 180, unit: 'per kilogram' }
    ],
    availability: 'available'
  });

  const listingRes = await genClient.request('/api/generator/listings', {
    recyclerId: recRes.data.user.id,
    materialId: 'cardboard',
    declaredQuantity: 50,
    quantityUnit: 'kg',
    locationAddress: '22 Obafemi Awolowo Way, Ikeja',
    preferredArrangement: 'pickup',
    description: 'Clean flattened cartons'
  });

  // Pending listing created
  const pendingListingId = listingRes.data.listing.id;

  return { genClient, recClient, pendingListingId, genUser: genRes.data.user, recUser: recRes.data.user };
}

test('FR-18: Real-time message exchange between matched generator and recycler on accepted listing', async t => {
  const env = await fixture(t);
  const { genClient, recClient, pendingListingId, genUser, recUser } = await setupAcceptedListing(env);

  // Recycler accepts listing
  const acceptRes = await recClient.request('/api/recycler/listings/respond', {
    listingId: pendingListingId,
    decision: 'accepted',
    agreedArrangement: 'pickup',
    arrangementNote: 'Truck arriving at 2 PM'
  });
  assert.equal(acceptRes.status, 200);

  // 1. Generator sends initial coordination message
  const genMsgRes = await genClient.request('/api/chat/send', {
    listingId: pendingListingId,
    message: 'Hello! Please call driver when 10 minutes away.'
  });
  assert.equal(genMsgRes.status, 200);
  assert.equal(genMsgRes.data.ok, true);
  assert.equal(genMsgRes.data.message.message, 'Hello! Please call driver when 10 minutes away.');
  assert.equal(genMsgRes.data.message.sender_user_id, genUser.id);
  assert.equal(genMsgRes.data.message.recipient_user_id, recUser.id);

  // 2. Recycler reads messages and replies
  const recFetchRes = await recClient.request('/api/chat/messages', { listingId: pendingListingId });
  assert.equal(recFetchRes.status, 200);
  assert.equal(recFetchRes.data.messages.length, 1);
  assert.equal(recFetchRes.data.messages[0].message, 'Hello! Please call driver when 10 minutes away.');
  assert.equal(recFetchRes.data.messages[0].sender_name, genUser.name);

  // Recycler sends reply
  const recMsgRes = await recClient.request('/api/chat/send', {
    listingId: pendingListingId,
    message: 'Noted! Driver Segun (+234 802 999 8888) is en route with scale.'
  });
  assert.equal(recMsgRes.status, 200);
  assert.equal(recMsgRes.data.message.sender_user_id, recUser.id);
  assert.equal(recMsgRes.data.message.recipient_user_id, genUser.id);

  // 3. Generator fetches full thread in chronological sequence
  const genThreadRes = await genClient.request('/api/chat/messages', { listingId: pendingListingId });
  assert.equal(genThreadRes.status, 200);
  assert.equal(genThreadRes.data.messages.length, 2);
  assert.equal(genThreadRes.data.messages[0].message, 'Hello! Please call driver when 10 minutes away.');
  assert.equal(genThreadRes.data.messages[1].message, 'Noted! Driver Segun (+234 802 999 8888) is en route with scale.');
  assert.equal(genThreadRes.data.messages[1].sender_role, 'recycler');
});

test('FR-18: Access control and validation guards (403 for unauthorized party, 400 for pending listing / invalid message)', async t => {
  const env = await fixture(t);
  const { genClient, recClient, pendingListingId } = await setupAcceptedListing(env);

  // 1. Attempting to chat on pending (unaccepted) listing should fail with 400
  const earlySend = await genClient.request('/api/chat/send', {
    listingId: pendingListingId,
    message: 'Are you available?'
  });
  assert.equal(earlySend.status, 400);
  assert.match(earlySend.data.error, /Chat is only available for accepted and active transactions/i);

  const earlyFetch = await genClient.request('/api/chat/messages', { listingId: pendingListingId });
  assert.equal(earlyFetch.status, 400);

  // Recycler accepts listing
  await recClient.request('/api/recycler/listings/respond', {
    listingId: pendingListingId,
    decision: 'accepted',
    agreedArrangement: 'pickup'
  });

  // 2. Empty and whitespace-only messages are rejected
  const emptySend = await genClient.request('/api/chat/send', {
    listingId: pendingListingId,
    message: '   '
  });
  assert.equal(emptySend.status, 400);
  assert.match(emptySend.data.error, /Message cannot be empty/i);

  // 3. Message over 1000 characters is rejected
  const longSend = await genClient.request('/api/chat/send', {
    listingId: pendingListingId,
    message: 'a'.repeat(1001)
  });
  assert.equal(longSend.status, 400);
  assert.match(longSend.data.error, /1000 characters or fewer/i);

  // 4. Third-party intruder tries to view or send chat messages -> 403 Forbidden
  const intruderClient = env.makeClient();
  await intruderClient.registerAndVerify(thirdPartyDetails);

  const intruderRead = await intruderClient.request('/api/chat/messages', { listingId: pendingListingId });
  assert.equal(intruderRead.status, 403);
  assert.match(intruderRead.data.error, /do not have permission/i);

  const intruderSend = await intruderClient.request('/api/chat/send', {
    listingId: pendingListingId,
    message: 'I am eavesdropping!'
  });
  assert.equal(intruderSend.status, 403);
  assert.match(intruderSend.data.error, /do not have permission/i);
});

test('FR-18: Chat message persistence across database reboots', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ecosmart-chat-persist-'));
  const dbPath = join(dir, 'test.sqlite');

  let time = 1715000000000;
  const messages = [];
  const provider = {
    configured: true,
    send: async (email, code) => { messages.push({ email, code }); return 'msg_persist'; },
    sendNotification: async () => 'notif_persist'
  };

  // Phase 1: Create listing and exchange chat messages
  let app = createApp({ demoPayments: true, dbPath, now: () => time, provider, origin: 'http://localhost:3000' });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));

  function makePersistClient(getApp) {
    let cookie = '';
    async function request(path, data) {
      const currentApp = getApp();
      const res = await fetch(`http://127.0.0.1:${currentApp.server.address().port}${path}`, {
        method: data === undefined ? 'GET' : 'POST',
        headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json', Cookie: cookie },
        body: data === undefined ? undefined : JSON.stringify(data)
      });
      const jar = Object.fromEntries(cookie.split('; ').filter(Boolean).map(x => x.split('=')));
      for (const item of res.headers.getSetCookie()) {
        const [key, value] = item.split(';')[0].split('=');
        jar[key] = value;
      }
      cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
      return { status: res.status, data: await res.json() };
    }
    return { request };
  }

  const clientGen = makePersistClient(() => app);
  const clientRec = makePersistClient(() => app);

  // Register generator & recycler
  await clientGen.request('/api/register', generatorDetails);
  await clientGen.request('/api/verify', { code: messages.at(-1)?.code });

  await clientRec.request('/api/register', recyclerDetails);
  const recUserRes = await clientRec.request('/api/verify', { code: messages.at(-1)?.code });

  const appRes = await clientRec.request('/api/recycler/application', {
    businessName: 'Persistent Recycler Hub',
    contactPhone: '+234 803 000 0000',
    businessAddress: '10 Persistence St',
    govIdType: 'National Identity Number (NIN)',
    govIdNumber: '99887766554',
    govIdFile: 'govid',
    photoFile: 'photo',
    licenceType: 'CAC Business Registration',
    licenceNumber: 'RC-112233',
    licenceFile: 'lic',
    area: 'Ikeja, Lagos'
  });

  await adminRequest(app, '/api/admin/review-application', { applicationId: appRes.data.application.id, decision: 'approved' });
  await clientRec.request('/api/recycler/settings', { settings: [{ materialId: 'cardboard', accepted: true, price: 200, unit: 'per kilogram' }], availability: 'available' });

  const listRes = await clientGen.request('/api/generator/listings', {
    recyclerId: recUserRes.data.user.id,
    materialId: 'cardboard',
    declaredQuantity: 40,
    quantityUnit: 'kg',
    locationAddress: '50 Persistence Way',
    preferredArrangement: 'pickup'
  });

  const listingId = listRes.data.listing.id;

  await clientRec.request('/api/recycler/listings/respond', { listingId, decision: 'accepted', agreedArrangement: 'pickup' });

  // Send messages
  await clientGen.request('/api/chat/send', { listingId, message: 'Message before server restart' });
  time += 5000;
  await clientRec.request('/api/chat/send', { listingId, message: 'Reply before server restart' });

  // Close server and database
  await new Promise(resolve => app.server.close(resolve));
  app.db.close();

  // Phase 2: Restart server on same database file
  app = createApp({ demoPayments: true, dbPath, now: () => time, provider, origin: 'http://localhost:3000' });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => app.server.close(resolve));
    app.db.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  // Verify chat messages survived restart
  const postRestartGen = await clientGen.request('/api/chat/messages', { listingId });
  assert.equal(postRestartGen.status, 200);
  assert.equal(postRestartGen.data.messages.length, 2);
  assert.equal(postRestartGen.data.messages[0].message, 'Message before server restart');
  assert.equal(postRestartGen.data.messages[1].message, 'Reply before server restart');
});
