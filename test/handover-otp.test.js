import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { analyzeWasteImage } from '../vision.js';
import { adminRequest } from '../test-support/admin.js';

const generatorDetails = { role: 'generator', name: 'Generator User', email: 'gen@ecosmart.ng', area: 'Ikeja, Lagos' };
const recyclerDetails = { role: 'recycler', name: 'Recycler Boss', email: 'recycler@ecosmart.ng', area: 'Ikeja, Lagos' };

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
      { materialId: 'pet_plastic_bottles', accepted: true, price: 200, unit: 'per kilogram' }
    ],
    availability: 'available'
  });

  const listingRes = await genClient.request('/api/generator/listings', {
    recyclerId: recRes.data.user.id,
    materialId: 'pet_plastic_bottles',
    declaredQuantity: 15,
    quantityUnit: 'kg',
    locationAddress: 'Plot 4, Allen Ave, Ikeja',
    preferredArrangement: 'pickup',
    description: '15kg clean PET beverage bottles'
  });

  return { genClient, recClient, listing: listingRes.data.listing, genUser: genRes.data.user, recUser: recRes.data.user };
}

test('AI vision benchmark returns estimated value calculation', async () => {
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  detectedMaterialId: 'pet_plastic_bottles',
                  confidence: 'high',
                  description: 'Clean plastic water bottles',
                  recyclabilityTips: 'Rinse and remove caps'
                })
              }
            ]
          }
        }
      ]
    })
  });

  const result = await analyzeWasteImage({
    photoFile: 'data:image/jpeg;base64,' + Buffer.from('test 1234567890 1234567890 1234567890 1234567890 1234567890').toString('base64'),
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  });

  assert.equal(result.ok, true);
  assert.equal(result.detected, true);
  assert.equal(result.isSupported, true);
  assert.equal(result.materialId, 'pet_plastic_bottles');
  assert.equal(result.estimatedRatePerKg, 200);
  assert.ok(result.estimatedValueTip.includes('5kg of plastic'));
  assert.ok(result.estimatedValueTip.includes('₦1,000'));
});

test('Handover Confirmation Code (OTP) lifecycle: generation, privacy redaction, and verification', async (t) => {
  const env = await fixture(t);
  const { genClient, recClient, listing } = await setupUsersAndListing(env);

  // 1. Recycler accepts listing
  const respondRes = await recClient.request('/api/recycler/listings/respond', {
    listingId: listing.id,
    decision: 'accepted',
    agreedArrangement: 'pickup',
    arrangementNote: 'Driver dispatched'
  });
  assert.equal(respondRes.status, 200);

  // 2. Generator views listing details: must see the 4-digit handover_code
  const genDetails = await genClient.request('/api/listings/details', { listingId: listing.id });
  assert.equal(genDetails.status, 200);
  assert.match(genDetails.data.listing.handover_code, /^[0-9]{4}$/, 'Generator sees 4-digit code');
  const secretOtp = genDetails.data.listing.handover_code;

  // 3. Recycler views listing details: handover_code MUST be redacted (null)
  const recDetails = await recClient.request('/api/listings/details', { listingId: listing.id });
  assert.equal(recDetails.status, 200);
  assert.equal(recDetails.data.listing.handover_code, null, 'Recycler cannot see generator OTP in details');

  // 4. Recycler also cannot see handover_code in state incoming requests
  const recState = await recClient.request('/api/state');
  const incomingReq = recState.data.incomingRequests.find(r => r.id === listing.id);
  assert.ok(incomingReq);
  assert.equal(incomingReq.handover_code, null, 'Recycler cannot see OTP in incoming requests state');

  // 5. Recycler submits invalid handover code -> rejects with HTTP 400
  const wrongCodeRes = await recClient.request('/api/recycler/listings/handover-complete', {
    listingId: listing.id,
    handoverCode: '9999'
  });
  assert.equal(wrongCodeRes.status, 400);
  assert.match(wrongCodeRes.data.error, /Invalid handover confirmation code/);

  // 6. Recycler submits blank handover code -> rejects with HTTP 400
  const emptyCodeRes = await recClient.request('/api/recycler/listings/handover-complete', {
    listingId: listing.id,
    handoverCode: ''
  });
  assert.equal(emptyCodeRes.status, 400);

  // 7. Recycler submits correct handover code -> succeeds with HTTP 200
  const successRes = await recClient.request('/api/recycler/listings/handover-complete', {
    listingId: listing.id,
    handoverCode: secretOtp
  });
  assert.equal(successRes.status, 200);
  assert.equal(successRes.data.listing.status, 'handover arranged');
});

test('Voice call endpoint returns clean disabled status', async (t) => {
  const env = await fixture(t);
  const genClient = env.makeClient();
  await genClient.registerAndVerify(generatorDetails);

  const callRes = await genClient.request('/api/call/status', { listingId: 'some-listing' });
  assert.equal(callRes.status, 503);
  assert.match(callRes.data.error, /Voice calls are not available/);
});
