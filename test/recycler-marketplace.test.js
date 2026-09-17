import { adminRequest, seedWallet } from '../test-support/admin.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';
import { AppError } from '../email.js';

const recyclerDetails = { role: 'recycler', name: 'Alhaji Scrap Ventures', email: 'recycler@ecosmart.ng', area: 'Ikeja, Lagos' };
const generatorDetails = { role: 'generator', name: 'Generator Person', email: 'generator@ecosmart.ng', area: 'Ikeja, Lagos' };

async function fixture(t, options = {}) {
  let time = Date.now();
  const messages = [];
  const provider = { configured: true, send: async (email, code) => { messages.push({ email, code }); return 'email_test'; }, ...options.provider };
  const app = createApp({ demoPayments: true, dbPath: ':memory:', now: () => time, ...options, provider, origin: 'http://localhost:3000' });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); app.db.close(); });
  
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

  return { ...app, request, registerAndVerify, messages, advance: ms => time += ms };
}

test('Recycler registration flows to verification application, admin review, and marketplace setup', async t => {
  const app = await fixture(t);
  
  // 1. Register & verify email as recycler
  const verified = await app.registerAndVerify(recyclerDetails);
  assert.equal(verified.status, 200);
  assert.equal(verified.data.user.role, 'recycler');
  assert.equal(verified.data.user.accountStatus, 'pending recycler approval');
  assert.equal(verified.data.user.nextScreen, 'Recycler verification application');

  // Check state
  const state1 = await app.request('/api/state');
  assert.equal(state1.data.user.role, 'recycler');
  assert.equal(state1.data.recyclerApplication, null);
  assert.equal(state1.data.materials.length, 5); // 5 pilot materials seeded

  // 2. Unapproved recycler cannot configure marketplace settings
  const forbiddenSettings = await app.request('/api/recycler/settings', {
    settings: [{ materialId: 'cardboard', accepted: true, price: 150, unit: 'per kilogram' }]
  });
  assert.equal(forbiddenSettings.status, 403);

  // 3. Submit Recycler Verification Application (Screen 2)
  const invalidApp = await app.request('/api/recycler/application', {
    businessName: 'A', // too short
    contactPhone: '+234 801 234 5678',
    businessAddress: '12 Scrap Yard Way',
    govIdType: 'National Identity Number (NIN)',
    govIdNumber: '12345678901',
    govIdFile: 'data:image/png;base64,sampleId',
    photoFile: 'data:image/png;base64,samplePhoto',
    licenceType: 'CAC Business Registration',
    licenceNumber: 'RC-123456',
    licenceFile: 'data:image/png;base64,sampleLicence',
    area: 'Ikeja, Lagos'
  });
  assert.equal(invalidApp.status, 400);

  const validApp = await app.request('/api/recycler/application', {
    businessName: 'Alhaji Scrap & Recycling Ventures',
    contactPhone: '+234 801 234 5678',
    businessAddress: '12 Scrap Yard Way, Industrial Estate',
    govIdType: 'National Identity Number (NIN)',
    govIdNumber: '12345678901',
    govIdFile: 'data:image/png;base64,sampleIdData',
    photoFile: 'data:image/png;base64,samplePhotoData',
    licenceType: 'CAC Business Registration',
    licenceNumber: 'RC-123456',
    licenceFile: 'data:image/png;base64,sampleLicenceData',
    area: 'Ikeja, Lagos'
  });
  assert.equal(validApp.status, 200);
  assert.equal(validApp.data.application.status, 'pending');
  assert.equal(validApp.data.application.business_name, 'Alhaji Scrap & Recycling Ventures');
  assert.equal(validApp.data.application.contact_phone, '+234 801 234 5678');
  assert.equal(validApp.data.application.business_address, '12 Scrap Yard Way, Industrial Estate');
  const appId = validApp.data.application.id;

  // 4. Admin Review: Reject with note
  const rejectReview = await adminRequest(app, '/api/admin/review-application', {
    applicationId: appId,
    decision: 'rejected',
    note: 'CAC licence scan is incomplete. Please re-upload.'
  });
  assert.equal(rejectReview.status, 200);
  assert.equal(rejectReview.data.application.status, 'rejected');
  assert.equal(rejectReview.data.application.admin_note, 'CAC licence scan is incomplete. Please re-upload.');
  assert.equal(rejectReview.data.user.accountStatus, 'rejected');

  // 5. Recycler resubmits application with updated details
  const resubmitted = await app.request('/api/recycler/application', {
    businessName: 'Alhaji Scrap & Recycling Ventures',
    contactPhone: '+234 801 234 5678',
    businessAddress: '12 Scrap Yard Way, Industrial Estate',
    govIdType: 'National Identity Number (NIN)',
    govIdNumber: '12345678901',
    govIdFile: 'data:image/png;base64,sampleIdDataUpdated',
    photoFile: 'data:image/png;base64,samplePhotoData',
    licenceType: 'CAC Business Registration',
    licenceNumber: 'RC-123456',
    licenceFile: 'data:image/png;base64,sampleLicenceDataUpdated',
    area: 'Ikeja, Lagos'
  });
  assert.equal(resubmitted.status, 200);
  assert.equal(resubmitted.data.application.status, 'pending');

  // 6. Admin Review: Approve application
  const approveReview = await adminRequest(app, '/api/admin/review-application', {
    applicationId: appId,
    decision: 'approved',
    note: 'All documents verified and approved.'
  });
  assert.equal(approveReview.status, 200);
  assert.equal(approveReview.data.application.status, 'approved');
  assert.equal(approveReview.data.user.accountStatus, 'active');
  assert.equal(approveReview.data.user.nextScreen, 'Recycler marketplace dashboard');

  // 7. Approved Recycler configures Marketplace Settings (Screen 4: FR-03, FR-04)
  const invalidSettings = await app.request('/api/recycler/settings', {
    settings: [
      { materialId: 'unsupported_e_waste', accepted: true, price: 500, unit: 'per kilogram' }
    ]
  });
  assert.equal(invalidSettings.status, 400);

  const saveSettings = await app.request('/api/recycler/settings', {
    settings: [
      { materialId: 'cardboard', accepted: true, price: 130, unit: 'per kilogram' },
      { materialId: 'pet_plastic_bottles', accepted: true, price: 200, unit: 'per kilogram' },
      { materialId: 'aluminium', accepted: true, price: 900, unit: 'per kilogram' },
      { materialId: 'brass', accepted: false, price: 0, unit: 'per kilogram' },
      { materialId: 'glass', accepted: true, price: 60, unit: 'per item' }
    ],
    availability: 'available'
  });
  assert.equal(saveSettings.status, 200);
  assert.equal(saveSettings.data.materialSettings.length, 5);
  assert.equal(saveSettings.data.availability, 'available');

  // 8. Recycler toggles availability to unavailable
  const toggleAvail = await app.request('/api/recycler/availability', { availability: 'unavailable' });
  assert.equal(toggleAvail.status, 200);
  assert.equal(toggleAvail.data.availability, 'unavailable');

  // 9. State query returns all updated information
  const finalState = await app.request('/api/state');
  assert.equal(finalState.data.user.accountStatus, 'active');
  assert.equal(finalState.data.recyclerApplication.status, 'approved');
  assert.equal(finalState.data.availability, 'unavailable');
  assert.equal(finalState.data.materialSettings.find(s => s.material_id === 'cardboard').price, 130);
});

test('Generator cannot access recycler verification or marketplace setup endpoints', async t => {
  const app = await fixture(t);
  await app.registerAndVerify(generatorDetails);

  // Generator attempts to submit recycler application -> 401/403
  const genApp = await app.request('/api/recycler/application', {
    businessName: 'Generator Co',
    contactDetails: '123 Test St',
    govIdType: 'NIN',
    govIdNumber: '12345',
    govIdFile: 'data:id',
    photoFile: 'data:photo',
    licenceType: 'CAC',
    licenceNumber: 'RC-123',
    licenceFile: 'data:lic',
    area: 'Ikeja'
  });
  assert.equal(genApp.status, 401);

  // Generator attempts to configure recycler settings -> 401/403
  const genSettings = await app.request('/api/recycler/settings', {
    settings: [{ materialId: 'cardboard', accepted: true, price: 100, unit: 'per kilogram' }]
  });
  assert.equal(genSettings.status, 401);
});

test('Recycler application, approval, and marketplace settings survive database reopen', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ecosmart-recycler-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'test.sqlite');

  let code;
  const first = createApp({ demoPayments: true, dbPath, provider: { configured: true, send: async (_, value) => { code = value; return 'mail'; } } });
  await new Promise(resolve => first.server.listen(0, '127.0.0.1', resolve));

  const headers = { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' };
  const base1 = `http://127.0.0.1:${first.server.address().port}`;

  // Register recycler
  const reg = await fetch(base1 + '/api/register', { method: 'POST', headers, body: JSON.stringify(recyclerDetails) });
  const pendingCookie = reg.headers.getSetCookie()[0].split(';')[0];
  const ver = await fetch(base1 + '/api/verify', { method: 'POST', headers: { ...headers, Cookie: pendingCookie }, body: JSON.stringify({ code }) });
  const sessionCookie = ver.headers.getSetCookie()[0].split(';')[0];

  // Submit application
  const appSub = await fetch(base1 + '/api/recycler/application', {
    method: 'POST',
    headers: { ...headers, Cookie: sessionCookie },
    body: JSON.stringify({
      businessName: 'Durable Recyclers Hub',
      contactPhone: '+234 800 000 1111',
      businessAddress: 'Plot 5, Admiralty Way, Lekki',
      govIdType: 'Driver Licence',
      govIdNumber: 'DL-999888',
      govIdFile: 'data:id',
      photoFile: 'data:photo',
      licenceType: 'Waste Management Permit',
      licenceNumber: 'WMP-456',
      licenceFile: 'data:lic',
      area: 'Lekki Phase 1, Lagos'
    })
  });
  const appData = await appSub.json();
  const appId = appData.application.id;

  // Approve
  const approval = await adminRequest(first, '/api/admin/review-application', {
    applicationId: appId,
    decision: 'approved',
    note: 'Approved durable recycler.'
  });
  assert.equal(approval.status, 200, approval.data.error);

  // Save settings
  await fetch(base1 + '/api/recycler/settings', {
    method: 'POST',
    headers: { ...headers, Cookie: sessionCookie },
    body: JSON.stringify({
      settings: [
        { materialId: 'aluminium', accepted: true, price: 950, unit: 'per kilogram' },
        { materialId: 'glass', accepted: true, price: 80, unit: 'per bag' }
      ],
      availability: 'available'
    })
  });

  await new Promise(resolve => first.server.close(resolve));
  first.db.close();

  // Reopen
  const second = createApp({ demoPayments: true, dbPath });
  await new Promise(resolve => second.server.listen(0, '127.0.0.1', resolve));
  const base2 = `http://127.0.0.1:${second.server.address().port}`;

  try {
    const reopenedState = await fetch(base2 + '/api/state', { headers: { Cookie: sessionCookie } });
    const stateData = await reopenedState.json();
    assert.equal(stateData.user.name, recyclerDetails.name);
    assert.equal(stateData.user.accountStatus, 'active');
    assert.equal(stateData.recyclerApplication.status, 'approved');
    assert.equal(stateData.recyclerApplication.business_name, 'Durable Recyclers Hub');
    const alumSetting = stateData.materialSettings.find(s => s.material_id === 'aluminium');
    assert.equal(alumSetting.price, 950);
    assert.equal(alumSetting.unit, 'per kilogram');
  } finally {
    await new Promise(resolve => second.server.close(resolve));
    second.db.close();
  }
});
