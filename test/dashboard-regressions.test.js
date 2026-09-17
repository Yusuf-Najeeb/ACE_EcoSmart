import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, marketplace } from '../test-support/fixture.js';
import { seedWallet } from '../test-support/admin.js';

test('Every admin endpoint rejects anonymous, generator, and recycler sessions', async t => {
  const env = await fixture(t);
  for (const role of [null, 'generator', 'recycler']) {
    const client = env.client(role);
    for (const path of ['applications', 'materials', 'materials/save', 'records', 'review-application']) {
      assert.equal((await client.request(`/api/admin/${path}`, {})).status, role ? 403 : 401, `${role}: ${path}`);
    }
  }
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM recycler_applications').get().n, 0);
});

test('Default payment mode cannot create credit, withdrawals, or funded offers', async t => {
  const env = await fixture(t, { demoPayments: false });
  const user = env.client('recycler');
  for (const path of ['/api/wallet/topup', '/api/wallet/withdraw', '/api/recycler/inspection/submit-offer']) {
    assert.equal((await user.request(path, { amount: 1000 })).status, 503);
  }
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM wallet_transactions').get().n, 0);
});

test('Offer funding rejects insufficient funds without partial inspection or ledger writes', async t => {
  const env = await fixture(t, { demoPayments: true });
  const { rec, listingId } = await marketplace(env);
  const res = await rec.request('/api/recycler/inspection/submit-offer', { listingId, actualQuantity: 10, amount: 1000 });
  assert.equal(res.status, 400);
  for (const table of ['final_offers', 'inspections', 'wallet_payments', 'wallet_transactions']) assert.equal(env.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0);
  assert.equal(env.db.prepare('SELECT status FROM listings WHERE id=?').get(listingId).status, 'accepted');
});

test('Expiry refunds once at the deadline through wallet reads and remains settled on details and decisions', async t => {
  const env = await fixture(t, { demoPayments: true });
  const { rec, gen, listingId } = await marketplace(env);
  seedWallet(env, rec.id, 1000);
  assert.equal((await rec.request('/api/recycler/inspection/submit-offer', { listingId, actualQuantity: 10, amount: 1000 })).status, 200);
  env.advance(86400000);
  for (let i = 0; i < 2; i++) {
    const wallet = (await rec.request('/api/wallet')).data.wallet;
    assert.equal(wallet.available_balance, 1000);
    assert.equal(wallet.escrow_locked_balance, 0);
    const detail = (await gen.request('/api/listings/details', { listingId })).data;
    assert.equal(detail.listing.status, 'expired');
    assert.equal(detail.finalOffer.funding_status, 'returned');
    assert.equal((await gen.request('/api/generator/offer/decision', { listingId, decision: 'accept' })).status, 400);
  }
  assert.equal(env.db.prepare("SELECT COUNT(*) AS n FROM wallet_transactions WHERE type='escrow_unlock'").get().n, 1);
  assert.equal(env.db.prepare("SELECT COUNT(*) AS n FROM wallet_payments WHERE payment_type='funding returned'").get().n, 1);
});

test('Matches and direct listing creation enforce service area, availability, and accepted material', async t => {
  const env = await fixture(t);
  const { rec, gen, listingInput } = await marketplace(env);
  env.db.prepare("UPDATE recycler_applications SET area='Abuja' WHERE user_id=?").run(rec.id);
  for (const [path, data] of [['/api/generator/matches?materialId=cardboard', undefined], ['/api/generator/matches', { materialId: 'cardboard' }]]) {
    assert.equal((await gen.request(path, data)).data.matches.length, 0);
  }
  assert.equal((await gen.request('/api/generator/listings', listingInput)).status, 400);
  env.db.prepare("UPDATE recycler_applications SET area='Ikeja, Lagos' WHERE user_id=?").run(rec.id);
  await rec.request('/api/recycler/availability', { availability: 'unavailable' });
  assert.equal((await gen.request('/api/generator/listings', listingInput)).status, 400);
  await rec.request('/api/recycler/availability', { availability: 'available' });
  env.db.prepare('UPDATE recycler_material_settings SET accepted=0 WHERE user_id=?').run(rec.id);
  assert.equal((await gen.request('/api/generator/listings', listingInput)).status, 400);
});

test('Counterparty contact details stay private until the recycler accepts', async t => {
  const env = await fixture(t);
  const rec = env.client('recycler'), gen = env.client('generator'), admin = env.client('administrator');
  const application = await rec.request('/api/recycler/application', {
    businessName: 'Private Recycler', contactPhone: '+2348029997777', businessAddress: '20 Private Road',
    govIdType: 'NIN', govIdNumber: '12345678901', govIdFile: 'data:image/png;base64,id', photoFile: 'data:image/png;base64,photo',
    licenceType: 'CAC', licenceNumber: 'RC-98765', licenceFile: 'data:image/png;base64,lic', area: 'Ikeja, Lagos'
  });
  await admin.request('/api/admin/review-application', { applicationId: application.data.application.id, decision: 'approved' });
  await rec.request('/api/recycler/settings', { settings: [{ materialId: 'cardboard', accepted: true, price: 200, unit: 'per kilogram' }] });
  const created = await gen.request('/api/generator/listings', {
    recyclerId: rec.id, materialId: 'cardboard', description: 'Private listing', declaredQuantity: 10,
    quantityUnit: 'kg', locationAddress: 'Pickup location', preferredArrangement: 'pickup'
  });
  const listingId = created.data.listing.id;

  const recState = await rec.request('/api/state');
  assert.equal(recState.data.incomingRequests[0].generator_email, null);
  const recDetails = await rec.request('/api/listings/details', { listingId });
  assert.equal(recDetails.data.listing.generator_email, null);
  assert.equal(recDetails.data.contactsShared, false);
  const recHistory = await rec.request('/api/user/records', {});
  assert.equal(recHistory.data.records[0].generator_email, null);

  const genDetails = await gen.request('/api/listings/details', { listingId });
  assert.equal(genDetails.data.listing.recycler_phone, null);
  assert.equal(genDetails.data.listing.recycler_yard_address, null);

  await rec.request('/api/recycler/listings/respond', { listingId, decision: 'accepted', agreedArrangement: 'pickup' });
  const acceptedRecState = await rec.request('/api/state');
  assert.match(acceptedRecState.data.incomingRequests[0].generator_email, /@example\.test$/);
  const acceptedGenDetails = await gen.request('/api/listings/details', { listingId });
  assert.equal(acceptedGenDetails.data.listing.recycler_phone, '+2348029997777');
  assert.equal(acceptedGenDetails.data.contactsShared, true);
});

test('Listings reject another generator’s intake record and malformed numeric fields', async t => {
  const env = await fixture(t);
  const { gen, listingInput } = await marketplace(env);
  const other = env.client('generator');
  const intake = await other.request('/api/generator/intake', { materialId: 'cardboard', intakeMethod: 'manual selection' });
  assert.equal((await gen.request('/api/generator/listings', { ...listingInput, materialIntakeId: intake.data.intake.id })).status, 400);
  assert.equal((await gen.request('/api/generator/listings', { ...listingInput, declaredQuantity: -1 })).status, 400);
  assert.equal((await gen.request('/api/generator/listings', { ...listingInput, quantityUnit: 'truckloads' })).status, 400);
});
