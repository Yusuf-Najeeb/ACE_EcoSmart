import { adminRequest, seedWallet } from '../test-support/admin.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';
import { openStorage } from '../storage.js';

const generatorDetails = { role: 'generator', name: 'Generator Person', email: 'generator@ecosmart.ng', area: 'Ikeja, Lagos' };
const recycler1Details = { role: 'recycler', name: 'Alhaji Ikeja Scrap', email: 'recycler1@ecosmart.ng', area: 'Ikeja, Lagos' };
const recycler2Details = { role: 'recycler', name: 'Lekki Eco Hub', email: 'recycler2@ecosmart.ng', area: 'Ikeja, Lagos' };

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

test('Matching returns verified available recyclers with non-binding estimates and supports one-recycler listing', async t => {
  const env = await fixture(t);
  const genClient = env.makeClient();
  const rec1Client = env.makeClient();
  const rec2Client = env.makeClient();

  // 1. Setup Generator in Ikeja
  const genVer = await genClient.registerAndVerify(generatorDetails);
  assert.equal(genVer.status, 200);

  // 2. Setup Recycler 1 (Ikeja) -> Approved, Cardboard ₦150/kg, PET ₦180/kg
  await rec1Client.registerAndVerify(recycler1Details);
  const app1 = await rec1Client.request('/api/recycler/application', {
    businessName: 'Alhaji Ikeja Scrap Ventures',
    contactPhone: '+234 801 111 2222',
    businessAddress: '10 Scrap Yard Way, Ikeja',
    govIdType: 'National Identity Number (NIN)',
    govIdNumber: '11112222333',
    govIdFile: 'data:image/png;base64,id1',
    photoFile: 'data:image/png;base64,photo1',
    licenceType: 'CAC Business Registration',
    licenceNumber: 'RC-111111',
    licenceFile: 'data:image/png;base64,lic1',
    area: 'Ikeja, Lagos'
  });
  // Admin approves Recycler 1
  await adminRequest(env, '/api/admin/review-application', {
    applicationId: app1.data.application.id,
    decision: 'approved'
  });
  // Recycler 1 saves settings
  await rec1Client.request('/api/recycler/settings', {
    settings: [
      { materialId: 'cardboard', accepted: true, price: 150, unit: 'per kilogram' },
      { materialId: 'pet_plastic_bottles', accepted: true, price: 180, unit: 'per kilogram' }
    ],
    availability: 'available'
  });

  // 3. Setup Recycler 2 (Lekki) -> Approved, Cardboard ₦140/kg
  await rec2Client.registerAndVerify(recycler2Details);
  const app2 = await rec2Client.request('/api/recycler/application', {
    businessName: 'Lekki Eco Hub Ltd',
    contactPhone: '+234 803 333 4444',
    businessAddress: '55 Admiralty Way, Lekki',
    govIdType: 'National Identity Number (NIN)',
    govIdNumber: '33334444555',
    govIdFile: 'data:image/png;base64,id2',
    photoFile: 'data:image/png;base64,photo2',
    licenceType: 'CAC Business Registration',
    licenceNumber: 'RC-222222',
    licenceFile: 'data:image/png;base64,lic2',
    area: 'Ikeja, Lagos'
  });
  await adminRequest(env, '/api/admin/review-application', {
    applicationId: app2.data.application.id,
    decision: 'approved'
  });
  await rec2Client.request('/api/recycler/settings', {
    settings: [
      { materialId: 'cardboard', accepted: true, price: 140, unit: 'per kilogram' }
    ],
    availability: 'available'
  });

  // 4. Generator searches for Cardboard matches (FR-08)
  const matchesRes = await genClient.request('/api/generator/matches?materialId=cardboard');
  assert.equal(matchesRes.status, 200);
  assert.equal(matchesRes.data.matches.length, 2);
  assert.equal(matchesRes.data.matches[0].businessName, 'Alhaji Ikeja Scrap Ventures');
  assert.equal(matchesRes.data.matches[0].estimatedPrice, 150);
  assert.equal(matchesRes.data.matches[0].priceUnit, 'per kilogram');
  assert.equal(matchesRes.data.matches[1].businessName, 'Lekki Eco Hub Ltd');

  // Generator searches for Brass (neither recycler accepts brass)
  const brassMatches = await genClient.request('/api/generator/matches?materialId=brass');
  assert.equal(brassMatches.status, 200);
  assert.equal(brassMatches.data.matches.length, 0);

  // 5. Test Availability toggle excludes unavailable recyclers
  await rec1Client.request('/api/recycler/availability', { availability: 'unavailable' });
  const matchesAfterPaused = await genClient.request('/api/generator/matches?materialId=cardboard');
  assert.equal(matchesAfterPaused.status, 200);
  assert.equal(matchesAfterPaused.data.matches.length, 1);
  assert.equal(matchesAfterPaused.data.matches[0].businessName, 'Lekki Eco Hub Ltd');

  // 6. Generator sends listing to Recycler 2 ONLY (FR-09)
  const targetRecyclerId = matchesAfterPaused.data.matches[0].recyclerId;
  const createListingRes = await genClient.request('/api/generator/listings', {
    recyclerId: targetRecyclerId,
    materialId: 'cardboard',
    description: '10 large flattened clean cartons',
    declaredQuantity: 20,
    quantityUnit: 'kg',
    locationAddress: 'Plot 12, Allen Ave, Ikeja',
    preferredArrangement: 'pickup'
  });

  assert.equal(createListingRes.status, 200);
  assert.equal(createListingRes.data.listing.status, 'sent to recycler');
  assert.equal(createListingRes.data.listing.material_id, 'cardboard');
  assert.equal(createListingRes.data.listing.declared_quantity, 20);
  assert.equal(createListingRes.data.listing.preferred_arrangement, 'pickup');
  assert.equal(createListingRes.data.listings.length, 1);

  // 7. Verify Recycler 2 receives the request in their incoming list on dashboard
  const rec2State = await rec2Client.request('/api/state');
  assert.equal(rec2State.data.incomingRequests.length, 1);
  assert.equal(rec2State.data.incomingRequests[0].material_id, 'cardboard');
  assert.equal(rec2State.data.incomingRequests[0].generator_name, 'Generator Person');
  assert.equal(rec2State.data.incomingRequests[0].declared_quantity, 20);
  assert.equal(rec2State.data.incomingRequests[0].preferred_arrangement, 'pickup');

  // 8. Verify Recycler 1 does NOT receive the listing (No broadcast)
  const rec1State = await rec1Client.request('/api/state');
  assert.equal(rec1State.data.incomingRequests.length, 0);
});

test('Matching and listings enforce authentication and role guards', async t => {
  const env = await fixture(t);
  const unauthClient = env.makeClient();
  const recClient = env.makeClient();

  // Unauthenticated requests
  const unauthMatches = await unauthClient.request('/api/generator/matches?materialId=cardboard');
  assert.equal(unauthMatches.status, 401);

  const unauthListing = await unauthClient.request('/api/generator/listings', {
    recyclerId: 'some-id',
    materialId: 'cardboard',
    locationAddress: 'Ikeja'
  });
  assert.equal(unauthListing.status, 401);

  // Recycler role trying to call generator endpoints
  await recClient.registerAndVerify(recycler1Details);
  const recMatches = await recClient.request('/api/generator/matches?materialId=cardboard');
  assert.equal(recMatches.status, 403);

  const recListing = await recClient.request('/api/generator/listings', {
    recyclerId: 'some-id',
    materialId: 'cardboard',
    locationAddress: 'Ikeja'
  });
  assert.equal(recListing.status, 403);
});

test('Listings and match results persist across database restart', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ecosmart-listing-test-'));
  const dbPath = join(dir, 'test.db');
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  let genCookie = '';
  let recCookie = '';
  let lastCode = '';

  // Instance 1
  {
    const app = createApp({ demoPayments: true,
      dbPath,
      origin: 'http://localhost:3000',
      provider: {
        configured: true,
        send: async (email, code) => {
          lastCode = code;
          return 'ok';
        }
      }
    });
    await new Promise(r => app.server.listen(0, '127.0.0.1', r));
    const port = app.server.address().port;

    // Register Recycler
    let rRes = await fetch(`http://127.0.0.1:${port}/api/register`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
      body: JSON.stringify(recycler1Details)
    });
    for (const item of rRes.headers.getSetCookie()) if (item.startsWith('eco_pending=')) recCookie = item.split(';')[0];
    let vRes = await fetch(`http://127.0.0.1:${port}/api/verify`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json', Cookie: recCookie },
      body: JSON.stringify({ code: lastCode })
    });
    for (const item of vRes.headers.getSetCookie()) if (item.startsWith('eco_session=')) recCookie = item.split(';')[0];

    // Submit and approve recycler
    const appRes = await fetch(`http://127.0.0.1:${port}/api/recycler/application`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json', Cookie: recCookie },
      body: JSON.stringify({
        businessName: 'Ikeja Green Yards',
        contactPhone: '+234 802 000 1111',
        businessAddress: '15 Industrial Rd, Ikeja',
        govIdType: 'National Identity Number (NIN)',
        govIdNumber: '99998888777',
        govIdFile: 'data:image/png;base64,id',
        photoFile: 'data:image/png;base64,photo',
        licenceType: 'CAC Business Registration',
        licenceNumber: 'RC-999999',
        licenceFile: 'data:image/png;base64,lic',
        area: 'Ikeja, Lagos'
      })
    });
    const appData = await appRes.json();
    await adminRequest(app, '/api/admin/review-application', { applicationId: appData.application.id, decision: 'approved' });
    await fetch(`http://127.0.0.1:${port}/api/recycler/settings`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json', Cookie: recCookie },
      body: JSON.stringify({
        settings: [{ materialId: 'pet_plastic_bottles', accepted: true, price: 190, unit: 'per kilogram' }],
        availability: 'available'
      })
    });

    // Register Generator
    let gRes = await fetch(`http://127.0.0.1:${port}/api/register`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
      body: JSON.stringify(generatorDetails)
    });
    for (const item of gRes.headers.getSetCookie()) if (item.startsWith('eco_pending=')) genCookie = item.split(';')[0];
    let gvRes = await fetch(`http://127.0.0.1:${port}/api/verify`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json', Cookie: genCookie },
      body: JSON.stringify({ code: lastCode })
    });
    for (const item of gvRes.headers.getSetCookie()) if (item.startsWith('eco_session=')) genCookie = item.split(';')[0];

    // Generator gets matches and sends listing
    const matchRes = await fetch(`http://127.0.0.1:${port}/api/generator/matches?materialId=pet_plastic_bottles`, {
      method: 'GET',
      headers: { Origin: 'http://localhost:3000', Cookie: genCookie }
    });
    const matchData = await matchRes.json();
    const targetRecId = matchData.matches[0].recyclerId;

    await fetch(`http://127.0.0.1:${port}/api/generator/listings`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json', Cookie: genCookie },
      body: JSON.stringify({
        recyclerId: targetRecId,
        materialId: 'pet_plastic_bottles',
        description: '5 large bags of rinsed water bottles',
        declaredQuantity: 5,
        quantityUnit: 'bags',
        locationAddress: '22 Toyin St, Ikeja',
        preferredArrangement: 'drop-off'
      })
    });

    await new Promise(r => app.server.close(r));
    app.db.close();
  }

  // Instance 2 (Verify in reopened storage)
  {
    const storage = openStorage(dbPath);
    const listings = storage.prepare('SELECT * FROM listings').all();
    assert.equal(listings.length, 1);
    assert.equal(listings[0].material_id, 'pet_plastic_bottles');
    assert.equal(listings[0].description, '5 large bags of rinsed water bottles');
    assert.equal(listings[0].declared_quantity, 5);
    assert.equal(listings[0].quantity_unit, 'bags');
    assert.equal(listings[0].preferred_arrangement, 'drop-off');
    assert.equal(listings[0].status, 'sent to recycler');

    const matchResults = storage.prepare('SELECT * FROM recycler_match_results WHERE match_status=?').all('selected');
    assert.equal(matchResults.length, 1);
    assert.equal(matchResults[0].material_id, 'pet_plastic_bottles');

    storage.close();
  }
});
