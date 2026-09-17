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
const adminDetails = { role: 'recycler', name: 'Admin Officer', email: 'admin@ecosmart.ng', area: 'Ikeja, Lagos' };

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

test('Admin workspace: verification queue retrieval, review, and approval/rejection notes', async t => {
  const env = await fixture(t);
  const adminClient = env.makeClient();
  const recClient1 = env.makeClient();
  const recClient2 = env.makeClient();

  await adminClient.registerAndVerify(adminDetails);
  await recClient1.registerAndVerify({ role: 'recycler', name: 'Recycler One', email: 'rec1@ecosmart.ng', area: 'Ikeja, Lagos' });
  await recClient2.registerAndVerify({ role: 'recycler', name: 'Recycler Two', email: 'rec2@ecosmart.ng', area: 'Surulere, Lagos' });

  // Submit application 1
  const app1 = await recClient1.request('/api/recycler/application', {
    businessName: 'Ikeja Green Yards',
    contactPhone: '+234 802 111 2222',
    businessAddress: '10 Scrap Ave, Ikeja',
    govIdType: 'National Identity Number (NIN)',
    govIdNumber: '11111111111',
    govIdFile: 'data:image/png;base64,govid1',
    photoFile: 'data:image/png;base64,photo1',
    licenceType: 'CAC Business Registration',
    licenceNumber: 'RC-111111',
    licenceFile: 'data:image/png;base64,lic1',
    area: 'Ikeja, Lagos'
  });
  assert.equal(app1.status, 200);

  // Submit application 2
  const app2 = await recClient2.request('/api/recycler/application', {
    businessName: 'Surulere Metals Ltd',
    contactPhone: '+234 803 222 3333',
    businessAddress: '25 Lagos Way, Surulere',
    govIdType: 'Driver Licence',
    govIdNumber: 'DL-22222222',
    govIdFile: 'data:image/png;base64,govid2',
    photoFile: 'data:image/png;base64,photo2',
    licenceType: 'Waste Management Authority Permit',
    licenceNumber: 'LAWMA-222',
    licenceFile: 'data:image/png;base64,lic2',
    area: 'Surulere, Lagos'
  });
  assert.equal(app2.status, 200);

  // Admin retrieves application queue
  const queueRes = await adminRequest(env, '/api/admin/applications', {});
  assert.equal(queueRes.status, 200);
  assert.equal(queueRes.data.applications.length, 2);
  assert.equal(queueRes.data.stats.pending, 2);

  // Approve App 1
  const approveRes = await adminRequest(env, '/api/admin/review-application', {
    applicationId: app1.data.application.id,
    decision: 'approved',
    note: 'All CAC documents and NIN verified.'
  });
  assert.equal(approveRes.status, 200);
  assert.equal(approveRes.data.application.status, 'approved');
  assert.equal(approveRes.data.application.admin_note, 'All CAC documents and NIN verified.');

  // Reject App 2
  const rejectRes = await adminRequest(env, '/api/admin/review-application', {
    applicationId: app2.data.application.id,
    decision: 'rejected',
    note: 'LAWMA permit expired. Please upload valid current permit.'
  });
  assert.equal(rejectRes.status, 200);
  assert.equal(rejectRes.data.application.status, 'rejected');
  assert.equal(rejectRes.data.application.admin_note, 'LAWMA permit expired. Please upload valid current permit.');

  // Check stats after review
  const updatedQueue = await adminRequest(env, '/api/admin/applications', {});
  assert.equal(updatedQueue.data.stats.approved, 1);
  assert.equal(updatedQueue.data.stats.rejected, 1);
  assert.equal(updatedQueue.data.stats.pending, 0);
});

test('Admin workspace: Supported materials catalogue management and active/inactive toggle enforcement', async t => {
  const env = await fixture(t);
  const adminClient = env.makeClient();
  const genClient = env.makeClient();
  const recClient = env.makeClient();

  await adminClient.registerAndVerify(adminDetails);
  await genClient.registerAndVerify(generatorDetails);
  await recClient.registerAndVerify(recyclerDetails);
  seedWallet(env, (await recClient.request('/api/state')).data.user.id);

  // Get initial catalogue
  const catRes = await adminRequest(env, '/api/admin/materials', {});
  assert.equal(catRes.status, 200);
  assert.ok(catRes.data.materials.length >= 5);
  const initialCount = catRes.data.materials.length;

  // Add new material
  const addRes = await adminRequest(env, '/api/admin/materials/save', {
    name: 'Copper Wire',
    guidance: 'Strip outer plastic insulation and bundle bare copper wire.',
    recyclable: 1,
    active: 1
  });
  assert.equal(addRes.status, 200);
  assert.equal(addRes.data.material.id, 'copper_wire');
  assert.equal(addRes.data.material.name, 'Copper Wire');
  assert.equal(addRes.data.materials.length, initialCount + 1);

  // Generator checks Copper Wire (now supported)
  const intakeRes = await genClient.request('/api/generator/intake', {
    materialId: 'copper_wire',
    intakeMethod: 'manual selection'
  });
  assert.equal(intakeRes.status, 200);
  assert.equal(intakeRes.data.supported, true);
  assert.equal(intakeRes.data.material.id, 'copper_wire');

  // Deactivate Copper Wire
  const deactRes = await adminRequest(env, '/api/admin/materials/save', {
    id: 'copper_wire',
    name: 'Copper Wire',
    guidance: 'Strip outer plastic insulation and bundle bare copper wire.',
    recyclable: 1,
    active: 0
  });
  assert.equal(deactRes.status, 200);
  assert.equal(deactRes.data.material.active, 0);

  // Generator checks Copper Wire again (now treated as unsupported)
  const intakeDeact = await genClient.request('/api/generator/intake', {
    materialId: 'copper_wire',
    intakeMethod: 'manual selection'
  });
  assert.equal(intakeDeact.status, 200);
  assert.equal(intakeDeact.data.supported, false);
});

test('Admin workspace: Marketplace records search, filtering, and audit log integration', async t => {
  const env = await fixture(t);
  const adminClient = env.makeClient();
  const genClient = env.makeClient();
  const recClient = env.makeClient();

  await adminClient.registerAndVerify(adminDetails);
  await genClient.registerAndVerify(generatorDetails);
  await recClient.registerAndVerify(recyclerDetails);
  seedWallet(env, (await recClient.request('/api/state')).data.user.id);

  // Recycler approval & settings
  const appRes = await recClient.request('/api/recycler/application', {
    businessName: 'Apex Recyclers Ikeja',
    contactPhone: '+234 802 999 8888',
    businessAddress: '55 Industrial Blvd, Ikeja',
    govIdType: 'National Identity Number (NIN)',
    govIdNumber: '99999999999',
    govIdFile: 'data:image/png;base64,govid',
    photoFile: 'data:image/png;base64,photo',
    licenceType: 'CAC Business Registration',
    licenceNumber: 'RC-999999',
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

  // Generator creates listing
  const listRes = await genClient.request('/api/generator/listings', {
    recyclerId: (await recClient.request('/api/state')).data.user.id,
    materialId: 'cardboard',
    description: '10 large shipping cartons clean and bundled',
    declaredQuantity: 30,
    quantityUnit: 'kg',
    locationAddress: 'Plot 4, Allen Ave, Ikeja',
    preferredArrangement: 'pickup'
  });
  const listingId = listRes.data.listing.id;

  // Recycler accepts
  const respRes = await recClient.request('/api/recycler/listings/respond', {
    listingId,
    decision: 'accepted',
    agreedArrangement: 'pickup',
    arrangementNote: 'Pickup scheduled for tomorrow 10am'
  });
  assert.equal(respRes.status, 200);

  // Recycler inspects and funds final offer
  const offerRes = await recClient.request('/api/recycler/inspection/submit-offer', {
    listingId,
    actualQuantity: 32,
    quantityUnit: 'kg',
    inspectionNotes: 'Weighed 32kg, dry and clean.',
    amount: 4800
  });
  assert.equal(offerRes.status, 200);

  // Generator accepts and completes payout
  const decRes = await genClient.request('/api/generator/offer/decision', {
    listingId,
    decision: 'accept'
  });
  assert.equal(decRes.status, 200);

  // Admin searches marketplace records
  const allRecords = await adminRequest(env, '/api/admin/records', {});
  assert.equal(allRecords.status, 200);
  assert.equal(allRecords.data.records.length, 1);
  assert.equal(allRecords.data.stats.completed, 1);
  assert.equal(allRecords.data.records[0].status, 'completed');
  assert.equal(allRecords.data.records[0].final_offer_amount, 4800);
  assert.equal(allRecords.data.records[0].actual_quantity, 32);

  // Search by query keyword
  const searchMatch = await adminRequest(env, '/api/admin/records', { query: 'Apex Recyclers' });
  assert.equal(searchMatch.data.records.length, 1);

  const searchNoMatch = await adminRequest(env, '/api/admin/records', { query: 'NonExistentYard' });
  assert.equal(searchNoMatch.data.records.length, 0);

  // Filter by status
  const filterCompleted = await adminRequest(env, '/api/admin/records', { status: 'completed' });
  assert.equal(filterCompleted.data.records.length, 1);

  const filterDeclined = await adminRequest(env, '/api/admin/records', { status: 'declined' });
  assert.equal(filterDeclined.data.records.length, 0);
});

test('User personal transaction history retrieval for generator and recycler', async t => {
  const env = await fixture(t);
  const adminClient = env.makeClient();
  const genClient = env.makeClient();
  const recClient = env.makeClient();

  await adminClient.registerAndVerify(adminDetails);
  await genClient.registerAndVerify(generatorDetails);
  await recClient.registerAndVerify(recyclerDetails);
  seedWallet(env, (await recClient.request('/api/state')).data.user.id);

  const appRes = await recClient.request('/api/recycler/application', {
    businessName: 'Personal History Scrap Yard',
    contactPhone: '+234 802 888 7777',
    businessAddress: '88 Ikeja Express',
    govIdType: 'National Identity Number (NIN)',
    govIdNumber: '88888888888',
    govIdFile: 'data:image/png;base64,govid',
    photoFile: 'data:image/png;base64,photo',
    licenceType: 'CAC Business Registration',
    licenceNumber: 'RC-888888',
    licenceFile: 'data:image/png;base64,lic',
    area: 'Ikeja, Lagos'
  });
  await adminRequest(env, '/api/admin/review-application', {
    applicationId: appRes.data.application.id,
    decision: 'approved'
  });

  await recClient.request('/api/recycler/settings', {
    settings: [{ materialId: 'pet_plastic_bottles', accepted: true, price: 200, unit: 'per kilogram' }]
  });

  const listRes = await genClient.request('/api/generator/listings', {
    recyclerId: (await recClient.request('/api/state')).data.user.id,
    materialId: 'pet_plastic_bottles',
    description: '3 large bags of clean sorted bottles',
    declaredQuantity: 15,
    quantityUnit: 'kg',
    locationAddress: 'Ikeja',
    preferredArrangement: 'drop-off'
  });

  // Generator gets personal records
  const genRecords = await genClient.request('/api/user/records', {});
  assert.equal(genRecords.status, 200);
  assert.equal(genRecords.data.records.length, 1);
  assert.equal(genRecords.data.records[0].material_id, 'pet_plastic_bottles');

  // Recycler gets personal records
  const recRecords = await recClient.request('/api/user/records', {});
  assert.equal(recRecords.status, 200);
  assert.equal(recRecords.data.records.length, 1);
  assert.equal(recRecords.data.records[0].id, listRes.data.listing.id);
});

test('Persistence across database restart for administration, catalogue, and audit records', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ecosmart-admin-persistence-'));
  const dbPath = join(dir, 'test.sqlite');
  let time = Date.now();
  const messages = [];

  const provider = {
    configured: true,
    send: async (email, code) => { messages.push({ email, code }); return 'email_test'; },
    sendNotification: async () => 'notif_test'
  };

  try {
    // 1. Initial server session
    {
      const app = createApp({ demoPayments: true, dbPath, now: () => time, provider, origin: 'http://localhost:3000' });
      await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));

      const port = app.server.address().port;
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

      await req('/api/register', adminDetails);
      const code = messages.at(-1)?.code;
      await req('/api/verify', { code });

      // Add a custom catalogue material
      const saveMat = await adminRequest(app, '/api/admin/materials/save', {
        name: 'Brass Fittings',
        guidance: 'Sort heavy brass plumbing fixtures and valves.',
        recyclable: 1,
        active: 1
      });
      assert.equal(saveMat.status, 200);

      await new Promise(resolve => app.server.close(resolve));
      app.db.close();
    }

    // 2. Restart server with same SQLite file
    {
      const app = createApp({ demoPayments: true, dbPath, now: () => time, provider, origin: 'http://localhost:3000' });
      await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));

      const port = app.server.address().port;
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

      // Check materials catalogue persisted
      const catRes = await adminRequest(app, '/api/admin/materials', {});
      assert.equal(catRes.status, 200);
      const brass = catRes.data.materials.find(m => m.id === 'brass_fittings');
      assert.ok(brass, 'brass_fittings should be persisted across restart');
      assert.equal(brass.name, 'Brass Fittings');

      await new Promise(resolve => app.server.close(resolve));
      app.db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Role separation: publicAccount metadata maps administrator, generator, and recycler correctly', async t => {
  const env = await fixture(t);
  const adminClient = env.makeClient();
  const genClient = env.makeClient();
  const recClient = env.makeClient();

  // Register generator and recycler
  const genVerify = await genClient.registerAndVerify(generatorDetails);
  assert.equal(genVerify.data.user.role, 'generator');
  assert.equal(genVerify.data.user.nextScreen, 'Check my waste');

  const recVerify = await recClient.registerAndVerify(recyclerDetails);
  seedWallet(env, recVerify.data.user.id);
  assert.equal(recVerify.data.user.role, 'recycler');
  assert.equal(recVerify.data.user.nextScreen, 'Recycler verification application');

  // Insert and verify an administrator user
  const adminId = 'admin_test_123';
  env.db.prepare(`
    INSERT INTO users (id, role, name, email, area, verification_status, account_status, created_at, updated_at)
    VALUES (?, 'administrator', 'Admin User', 'admin.corp@ecosmart.ng', 'HQ, Lagos', 'verified', 'active', ?, ?)
  `).run(adminId, env.now(), env.now());

  // Sign in administrator via login request
  const loginReq = await adminClient.request('/api/login/request', { email: 'admin.corp@ecosmart.ng' });
  assert.equal(loginReq.status, 200);
  const code = env.messages.at(-1)?.code;
  const adminVerify = await adminClient.request('/api/login/verify', { code });
  assert.equal(adminVerify.status, 200);
  assert.equal(adminVerify.data.user.role, 'administrator');
  assert.equal(adminVerify.data.user.nextScreen, 'Pilot Administrator Workspace');

  const adminState = await adminClient.request('/api/state');
  assert.equal(adminState.data.user.role, 'administrator');
  assert.equal(adminState.data.user.nextScreen, 'Pilot Administrator Workspace');
});
