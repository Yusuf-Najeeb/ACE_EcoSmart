import { adminRequest, seedWallet } from '../test-support/admin.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';

const generatorDetails = { role: 'generator', name: 'Amina Bello', email: 'amina@ecosmart.ng', area: 'Surulere, Lagos' };
const recyclerDetails = { role: 'recycler', name: 'Lagos Metal Aggregators', email: 'lagosmetals@ecosmart.ng', area: 'Ikeja, Lagos' };

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

  return { ...app, request, registerAndVerify, messages, advance: ms => time += ms, get cookie() { return cookie; }, clearCookie: () => cookie = '' };
}

test('Returning generator can request login OTP, verify, and restore active session', async t => {
  const app = await fixture(t);
  
  // 1. Register generator
  await app.registerAndVerify(generatorDetails);
  
  // 2. Sign out
  await app.request('/api/logout', {});
  const loggedOutState = await app.request('/api/state');
  assert.equal(loggedOutState.data.user, null);

  // 3. Request login OTP
  const loginReq = await app.request('/api/login/request', { email: generatorDetails.email });
  assert.equal(loginReq.status, 200);
  assert.equal(loginReq.data.email, generatorDetails.email);

  const loginCode = app.messages.at(-1)?.code;
  assert.match(loginCode, /^\d{6}$/);

  // 4. Submit incorrect login code
  const wrongCode = String((Number(loginCode) + 1) % 1000000).padStart(6, '0');
  const wrongVerify = await app.request('/api/login/verify', { code: wrongCode });
  assert.equal(wrongVerify.status, 400);

  // 5. Submit valid login code
  const verified = await app.request('/api/login/verify', { code: loginCode });
  assert.equal(verified.status, 200);
  assert.equal(verified.data.user.name, generatorDetails.name);
  assert.equal(verified.data.user.role, 'generator');
  assert.equal(verified.data.user.accountStatus, 'active');

  // 6. Session state is authenticated
  const state = await app.request('/api/state');
  assert.equal(state.data.user.name, generatorDetails.name);
  assert.equal(state.data.user.email, generatorDetails.email);
});

test('Returning approved recycler logs in and retrieves dashboard setup and settings', async t => {
  const app = await fixture(t);
  
  // 1. Register recycler & submit application & approve & configure
  const verified = await app.registerAndVerify(recyclerDetails);
  const appRes = await app.request('/api/recycler/application', {
    businessName: 'Lagos Metal Scrap Hub',
    contactPhone: '+234 803 111 2222',
    businessAddress: 'Plot 4, Scrap Market, Ikeja',
    govIdType: 'National Identity Number (NIN)',
    govIdNumber: '11223344556',
    govIdFile: 'data:id',
    photoFile: 'data:photo',
    licenceType: 'CAC Business Registration',
    licenceNumber: 'RC-554433',
    licenceFile: 'data:lic',
    area: 'Ikeja, Lagos'
  });
  const appId = appRes.data.application.id;

  await adminRequest(app, '/api/admin/review-application', {
    applicationId: appId,
    decision: 'approved',
    note: 'Verified aggregator.'
  });

  await app.request('/api/recycler/settings', {
    settings: [
      { materialId: 'aluminium', accepted: true, price: 850, unit: 'per kilogram' },
      { materialId: 'cardboard', accepted: true, price: 140, unit: 'per kilogram' }
    ],
    availability: 'available'
  });

  // 2. Sign out
  await app.request('/api/logout', {});

  // 3. Login as returning recycler
  await app.request('/api/login/request', { email: recyclerDetails.email });
  const loginCode = app.messages.at(-1)?.code;
  const loginVerify = await app.request('/api/login/verify', { code: loginCode });

  assert.equal(loginVerify.status, 200);
  assert.equal(loginVerify.data.user.role, 'recycler');
  assert.equal(loginVerify.data.user.accountStatus, 'active');
  assert.equal(loginVerify.data.user.nextScreen, 'Recycler marketplace dashboard');
  assert.equal(loginVerify.data.recyclerApplication.status, 'approved');
  assert.equal(loginVerify.data.availability, 'available');
  assert.equal(loginVerify.data.materialSettings.find(s => s.material_id === 'aluminium').price, 850);
});

test('Unregistered email cannot request login code', async t => {
  const app = await fixture(t);
  const res = await app.request('/api/login/request', { email: 'unknown@ecosmart.ng' });
  assert.equal(res.status, 404);
});

test('Login resend cooldown and expiry enforcement', async t => {
  const app = await fixture(t);
  await app.registerAndVerify(generatorDetails);
  await app.request('/api/logout', {});

  await app.request('/api/login/request', { email: generatorDetails.email });
  const firstCode = app.messages.at(-1)?.code;

  // Resend before cooldown -> 429
  const fastResend = await app.request('/api/login/resend', {});
  assert.equal(fastResend.status, 429);

  // Expire code after 10m
  app.advance(600001);
  const expiredVerify = await app.request('/api/login/verify', { code: firstCode });
  assert.equal(expiredVerify.status, 410);

  // Resend after cooldown -> 200
  const validResend = await app.request('/api/login/resend', {});
  assert.equal(validResend.status, 200);
  const secondCode = app.messages.at(-1)?.code;
  const verified = await app.request('/api/login/verify', { code: secondCode });
  assert.equal(verified.status, 200);
});
