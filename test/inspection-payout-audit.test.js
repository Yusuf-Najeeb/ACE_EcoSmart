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

async function setupCoordinatedListing(env) {
  const genClient = env.makeClient();
  const recClient = env.makeClient();

  const genRes = await genClient.registerAndVerify(generatorDetails);
  const recRes = await recClient.registerAndVerify(recyclerDetails);
  seedWallet(env, recRes.data.user.id);

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
    declaredQuantity: 25,
    quantityUnit: 'kg',
    locationAddress: 'Plot 4, Allen Ave, Ikeja',
    preferredArrangement: 'pickup',
    description: '25kg flattened clean carton bundles'
  });

  // Recycler accepts listing
  await recClient.request('/api/recycler/listings/respond', {
    listingId: listingRes.data.listing.id,
    decision: 'accepted',
    agreedArrangement: 'pickup',
    arrangementNote: 'Driver coming today at 3pm.'
  });

  // Recycler marks handover complete
  await recClient.request('/api/recycler/listings/handover-complete', {
    listingId: listingRes.data.listing.id
  });

  return { genClient, recClient, listing: listingRes.data.listing, genUser: genRes.data.user, recUser: recRes.data.user };
}

test('FR-12 & FR-13: Recycler records inspection and funds final offer into escrow', async t => {
  const env = await fixture(t);
  const { genClient, recClient, listing } = await setupCoordinatedListing(env);

  // 1. Recycler records inspection & funds offer
  const offerRes = await recClient.request('/api/recycler/inspection/submit-offer', {
    listingId: listing.id,
    actualQuantity: 24.5,
    quantityUnit: 'kg',
    inspectionNotes: 'Clean, dry corrugated cardboard. Verified on certified scale.',
    amount: 3920 // 24.5kg * ₦160/kg = ₦3,920
  });

  assert.equal(offerRes.status, 200);
  assert.equal(offerRes.data.listing.status, 'funded final offer');
  assert.equal(offerRes.data.inspection.actual_quantity, 24.5);
  assert.equal(offerRes.data.finalOffer.amount, 3920);
  assert.equal(offerRes.data.finalOffer.funding_status, 'funded');

  // 2. Cannot send unfunded offer or non-positive amount
  const badOfferRes = await recClient.request('/api/recycler/inspection/submit-offer', {
    listingId: listing.id,
    actualQuantity: 10,
    quantityUnit: 'kg',
    amount: 0
  });
  assert.equal(badOfferRes.status, 400);

  // 3. Generator views listing details: sees inspection data, funded offer, and 24h expiry
  const genDetails = await genClient.request('/api/listings/details', { listingId: listing.id });
  assert.equal(genDetails.status, 200);
  assert.equal(genDetails.data.listing.status, 'funded final offer');
  assert.equal(genDetails.data.inspection.actual_quantity, 24.5);
  assert.equal(genDetails.data.finalOffer.amount, 3920);
  assert.ok(genDetails.data.finalOffer.expires_at > Date.now());

  // 4. Verify notification dispatched to generator
  assert.ok(env.notifications.some(n => n.email === generatorDetails.email && n.subject.includes('Final Offer Funded')));
});

test('FR-14 & FR-15: Generator accepts funded offer within 24h -> 100% payout released with ₦0 commission', async t => {
  const env = await fixture(t);
  const { genClient, recClient, listing } = await setupCoordinatedListing(env);

  // Recycler funds offer
  await recClient.request('/api/recycler/inspection/submit-offer', {
    listingId: listing.id,
    actualQuantity: 20,
    quantityUnit: 'kg',
    inspectionNotes: 'Inspected and weighed.',
    amount: 3200
  });

  // Generator accepts offer
  const acceptRes = await genClient.request('/api/generator/offer/decision', {
    listingId: listing.id,
    decision: 'accept'
  });

  assert.equal(acceptRes.status, 200);
  assert.equal(acceptRes.data.listing.status, 'completed');
  assert.equal(acceptRes.data.payment.amount, 3200);
  assert.equal(acceptRes.data.payment.commission_amount, 0); // ₦0 pilot commission
  assert.equal(acceptRes.data.payment.status, 'released');

  // Verify details reflect completion and receipt
  const details = await genClient.request('/api/listings/details', { listingId: listing.id });
  assert.equal(details.data.listing.status, 'completed');
  assert.equal(details.data.payments.length, 2); // 1. recycler funding, 2. generator payout
  assert.equal(details.data.payments[1].status, 'released');
  assert.equal(details.data.payments[1].commission_amount, 0);
  assert.equal(details.data.payments[1].amount, 3200);
});

test('FR-14: Generator rejects funded offer -> escrow returned to recycler with no payout', async t => {
  const env = await fixture(t);
  const { genClient, recClient, listing } = await setupCoordinatedListing(env);

  await recClient.request('/api/recycler/inspection/submit-offer', {
    listingId: listing.id,
    actualQuantity: 15,
    quantityUnit: 'kg',
    amount: 2400
  });

  const rejectRes = await genClient.request('/api/generator/offer/decision', {
    listingId: listing.id,
    decision: 'reject',
    rejectionReason: 'Measured weight was lower than expected.'
  });

  assert.equal(rejectRes.status, 200);
  assert.equal(rejectRes.data.listing.status, 'offer rejected');
  assert.equal(rejectRes.data.finalOffer.offer_status, 'rejected');

  const details = await genClient.request('/api/listings/details', { listingId: listing.id });
  assert.equal(details.data.listing.status, 'offer rejected');
  assert.equal(details.data.payments[1].status, 'returned');
  assert.equal(details.data.payments[1].commission_amount, 0);
});

test('24-Hour Expiry: Unanswered offer expires after 24h and refunds escrow', async t => {
  const env = await fixture(t);
  const { genClient, recClient, listing } = await setupCoordinatedListing(env);

  await recClient.request('/api/recycler/inspection/submit-offer', {
    listingId: listing.id,
    actualQuantity: 10,
    quantityUnit: 'kg',
    amount: 1600
  });

  // Advance time by 25 hours (25 * 60 * 60 * 1000 ms)
  env.advance(25 * 60 * 60 * 1000);

  // Fetching details auto-triggers expiration
  const details = await genClient.request('/api/listings/details', { listingId: listing.id });
  assert.equal(details.data.listing.status, 'expired');
  assert.equal(details.data.finalOffer.offer_status, 'expired');
  assert.equal(details.data.payments[1].status, 'refunded');

  // Generator attempting to accept expired offer should fail
  const acceptRes = await genClient.request('/api/generator/offer/decision', {
    listingId: listing.id,
    decision: 'accept'
  });
  assert.equal(acceptRes.status, 400);
  assert.match(acceptRes.data.error, /expired/i);
});

test('FR-16: Core time-stamped audit trail records all lifecycle milestones in order', async t => {
  const env = await fixture(t);
  const { genClient, recClient, listing } = await setupCoordinatedListing(env);

  await recClient.request('/api/recycler/inspection/submit-offer', {
    listingId: listing.id,
    actualQuantity: 28,
    quantityUnit: 'kg',
    inspectionNotes: 'Audit test inspection note.',
    amount: 4480
  });

  await genClient.request('/api/generator/offer/decision', {
    listingId: listing.id,
    decision: 'accept'
  });

  const details = await genClient.request('/api/listings/details', { listingId: listing.id });
  assert.equal(details.status, 200);

  const eventTypes = details.data.events.map(e => e.event_type);
  assert.ok(eventTypes.includes('listing_created'), 'Should log listing creation');
  assert.ok(eventTypes.includes('response_accepted'), 'Should log acceptance & contact unlock');
  assert.ok(eventTypes.includes('handover_completed'), 'Should log physical handover');
  assert.ok(eventTypes.includes('inspection_recorded'), 'Should log physical inspection');
  assert.ok(eventTypes.includes('offer_funded_and_sent'), 'Should log escrow funded offer');
  assert.ok(eventTypes.includes('offer_accepted'), 'Should log offer acceptance');
  assert.ok(eventTypes.includes('payout_released'), 'Should log zero-commission payout release');

  // Verify timestamps are sequential
  for (let i = 1; i < details.data.events.length; i++) {
    assert.ok(details.data.events[i].created_at >= details.data.events[i - 1].created_at);
  }
});

test('Persistence: Inspection, funded offers, wallet payments and audit events persist across database reload', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'ecosmart-persist-test-'));
  const dbPath = join(tempDir, 'persist.sqlite');

  let listingId, offerId;

  // Instance 1: Create and execute through server
  {
    let lastCode = '';
    const messages = [];
    const provider = { configured: true, send: async (email, code) => { lastCode = code; messages.push({ email, code }); return 'test'; } };
    const app = createApp({ demoPayments: true, dbPath, origin: 'http://localhost:3000', provider });
    await new Promise(r => app.server.listen(0, '127.0.0.1', r));
    const port = app.server.address().port;

    let recCookie = '';
    let genCookie = '';

    // Register Recycler
    let rRes = await fetch(`http://127.0.0.1:${port}/api/register`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
      body: JSON.stringify(recyclerDetails)
    });
    for (const item of rRes.headers.getSetCookie()) if (item.startsWith('eco_pending=')) recCookie = item.split(';')[0];
    let rvRes = await fetch(`http://127.0.0.1:${port}/api/verify`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json', Cookie: recCookie },
      body: JSON.stringify({ code: lastCode })
    });
    for (const item of rvRes.headers.getSetCookie()) if (item.startsWith('eco_session=')) recCookie = item.split(';')[0];

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
        settings: [{ materialId: 'cardboard', accepted: true, price: 150, unit: 'per kilogram' }],
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

    const matchRes = await fetch(`http://127.0.0.1:${port}/api/generator/matches?materialId=cardboard`, {
      method: 'GET',
      headers: { Origin: 'http://localhost:3000', Cookie: genCookie }
    });
    const matchData = await matchRes.json();
    const targetRecId = matchData.matches[0].recyclerId;

    const listRes = await fetch(`http://127.0.0.1:${port}/api/generator/listings`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json', Cookie: genCookie },
      body: JSON.stringify({
        recyclerId: targetRecId,
        materialId: 'cardboard',
        description: 'Persistent listing carton bundles',
        declaredQuantity: 50,
        quantityUnit: 'kg',
        locationAddress: '22 Toyin St, Ikeja',
        preferredArrangement: 'pickup'
      })
    });
    const listData = await listRes.json();
    listingId = listData.listing.id;

    // Recycler accepts and marks handover
    await fetch(`http://127.0.0.1:${port}/api/recycler/listings/respond`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json', Cookie: recCookie },
      body: JSON.stringify({ listingId, decision: 'accepted' })
    });
    await fetch(`http://127.0.0.1:${port}/api/recycler/listings/handover-complete`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json', Cookie: recCookie },
      body: JSON.stringify({ listingId })
    });

    seedWallet(app, app.db.prepare("SELECT id FROM users WHERE role='recycler'").get().id);
    // Recycler submits funded offer
    const offerRes = await fetch(`http://127.0.0.1:${port}/api/recycler/inspection/submit-offer`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json', Cookie: recCookie },
      body: JSON.stringify({
        listingId,
        actualQuantity: 52,
        quantityUnit: 'kg',
        inspectionNotes: 'Persistence inspected boxes',
        amount: 7800
      })
    });
    const offerData = await offerRes.json();
    offerId = offerData.finalOffer.id;

    // Generator accepts offer
    await fetch(`http://127.0.0.1:${port}/api/generator/offer/decision`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json', Cookie: genCookie },
      body: JSON.stringify({ listingId, decision: 'accept' })
    });

    await new Promise(r => app.server.close(r));
    app.db.close();
  }

  // Instance 2: Verify in reopened storage
  {
    const storage = openStorage(dbPath);
    const listing = storage.prepare('SELECT * FROM listings WHERE id=?').get(listingId);
    assert.equal(listing.status, 'completed');

    const inspection = storage.prepare('SELECT * FROM inspections WHERE listing_id=?').get(listingId);
    assert.equal(inspection.actual_quantity, 52);
    assert.equal(inspection.inspection_note, 'Persistence inspected boxes');

    const offer = storage.prepare('SELECT * FROM final_offers WHERE id=?').get(offerId);
    assert.equal(offer.amount, 7800);
    assert.equal(offer.offer_status, 'accepted');

    const payments = storage.prepare('SELECT * FROM wallet_payments WHERE listing_id=? ORDER BY created_at ASC').all(listingId);
    assert.equal(payments.length, 2);
    assert.equal(payments[0].payment_type, 'recycler funding');
    assert.equal(payments[0].amount, 7800);
    assert.equal(payments[1].payment_type, 'generator payout');
    assert.equal(payments[1].amount, 7800);
    assert.equal(payments[1].commission_amount, 0);
    assert.equal(payments[1].status, 'released');

    const events = storage.prepare('SELECT * FROM transaction_events WHERE listing_id=? ORDER BY created_at ASC').all(listingId);
    assert.ok(events.length >= 5);
    assert.ok(events.some(e => e.event_type === 'payout_released'));

    storage.close();
  }
});
