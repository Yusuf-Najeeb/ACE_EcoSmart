import { adminRequest, seedWallet } from '../test-support/admin.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../server.js';

const generatorDetails = { role: 'generator', name: 'Maryam Generator', email: 'maryam@ecosmart.ng', area: 'Ikeja, Lagos' };
const recyclerDetails = { role: 'recycler', name: 'Ace Recycler', email: 'recycler@ecosmart.ng', area: 'Ikeja, Lagos' };

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

test('HTML and JS consistency: Screen 3 contains category dropdown and hero scan/upload actions', async () => {
  const html = readFileSync(join(process.cwd(), 'public', 'index.html'), 'utf-8');
  const js = readFileSync(join(process.cwd(), 'public', 'app.js'), 'utf-8');
  const css = readFileSync(join(process.cwd(), 'public', 'styles.css'), 'utf-8');

  // Verify elements in index.html
  assert.ok(html.includes('id="btn-intake-scan"'), 'Hero Scan button exists');
  assert.ok(html.includes('id="btn-intake-upload"'), 'Hero Upload button exists');
  assert.ok(html.includes('id="intake-category-select"'), 'Category select dropdown exists');
  assert.ok(!html.includes('id="supporting-manual-section"'), 'Supporting manual section removed');
  assert.ok(!html.includes('id="generator-material-grid"'), 'Supporting material grid removed');
  assert.ok(html.includes('id="guidance-panel"'), 'Guidance panel exists');
  assert.ok(html.includes('id="unsupported-panel"'), 'Unsupported panel exists');

  // Verify functions in app.js
  assert.ok(js.includes('function populateCategoryDropdown()'), 'populateCategoryDropdown function defined');
  assert.ok(js.includes('async function selectMaterialCategory('), 'selectMaterialCategory function defined');
  assert.ok(js.includes('intake-category-select'), 'intake-category-select referenced in app.js');
  assert.ok(js.includes('btn-clear-intake-photo'), 'btn-clear-intake-photo wired in app.js');

  // Verify styles in styles.css
  assert.ok(css.includes('.intake-hero-section'), 'intake-hero-section styled');
  assert.ok(css.includes('.intake-hero-btn'), 'intake-hero-btn styled');
  assert.ok(css.includes('.btn-scan-hero'), 'btn-scan-hero styled');
  assert.ok(css.includes('.btn-upload-hero'), 'btn-upload-hero styled');
  assert.ok(css.includes('.category-dropdown-select'), 'category-dropdown-select styled');
});

test('End-to-End API flow: Generator photo attachment and manual confirmation, material selection, matches and direct listing', async t => {
  const app = await fixture(t);

  // 1. Recycler register & setup marketplace acceptance for Cardboard & Glass
  const recReg = await app.registerAndVerify(recyclerDetails);
  assert.equal(recReg.status, 200);

  await app.request('/api/recycler/application', {
    businessName: 'Ace Recyclers Ltd',
    contactPhone: '+2348011112222',
    businessAddress: '12 Scrap Way, Ikeja',
    govIdType: 'NIN',
    govIdNumber: '12345678901',
    govIdFile: 'data:image/png;base64,mockId',
    photoFile: 'data:image/png;base64,mockPhoto',
    licenceType: 'CAC',
    licenceNumber: 'RC-998877',
    licenceFile: 'data:image/png;base64,mockLic',
    area: 'Ikeja, Lagos'
  });

  const adminApp = app.db.prepare('SELECT id FROM recycler_applications LIMIT 1').get();
  await adminRequest(app, '/api/admin/review-application', {
    applicationId: adminApp.id,
    decision: 'approved',
    note: 'Approved for pilot test'
  });

  await app.request('/api/recycler/settings', {
    settings: [
      { materialId: 'cardboard', accepted: true, price: 150, unit: 'per kilogram' },
      { materialId: 'glass', accepted: true, price: 90, unit: 'per kilogram' },
      { materialId: 'pet_plastic_bottles', accepted: false, price: 0, unit: 'per kilogram' },
      { materialId: 'aluminium', accepted: false, price: 0, unit: 'per kilogram' },
      { materialId: 'brass', accepted: false, price: 0, unit: 'per kilogram' }
    ],
    availability: 'available'
  });

  // 2. Generator registers
  const genReg = await app.registerAndVerify(generatorDetails);
  assert.equal(genReg.status, 200);

  // 3. Generator scans/uploads photo and analyzes image
  const analyzeRes = await app.request('/api/generator/intake-analyze', {
    fileName: 'scanned_cardboard_box.jpg',
    photoFile: 'data:image/jpeg;base64,mockScannedImage'
  });
  assert.equal(analyzeRes.status, 200);
  assert.equal(analyzeRes.data.detectedMaterialId, null);
  assert.equal(analyzeRes.data.confidence, 'unavailable');

  // 4. Generator records intake for Cardboard with photo attached
  const intakeRes = await app.request('/api/generator/intake', {
    materialId: 'cardboard',
    materialName: 'Cardboard',
    intakeMethod: 'scan',
    photoFile: 'data:image/jpeg;base64,mockScannedImage',
    recyclable: true,
    guidanceTip: 'Keep dry and flatten boxes.',
    outcome: 'continued to matching'
  });
  assert.equal(intakeRes.status, 200);
  assert.equal(intakeRes.data.intake.material_id, 'cardboard');
  assert.equal(intakeRes.data.intake.intake_method, 'scan');

  // 5. Generator queries matching recyclers
  const matchesRes = await app.request('/api/generator/matches', { materialId: 'cardboard' });
  assert.equal(matchesRes.status, 200);
  assert.equal(matchesRes.data.matches.length, 1);
  assert.equal(matchesRes.data.matches[0].businessName, 'Ace Recyclers Ltd');
  assert.equal(matchesRes.data.matches[0].estimatedPrice, 150);

  // 6. Generator dispatches listing with intake photo attached
  const listingRes = await app.request('/api/generator/listings', {
    recyclerId: matchesRes.data.matches[0].recyclerId,
    materialId: 'cardboard',
    description: '10 flattened shipping cartons',
    photoFile: 'data:image/jpeg;base64,mockScannedImage',
    declaredQuantity: 20,
    quantityUnit: 'kg',
    locationAddress: 'Plot 5, Allen Avenue, Ikeja',
    preferredArrangement: 'pickup'
  });
  assert.equal(listingRes.status, 200);
  assert.equal(listingRes.data.listing.status, 'sent to recycler');
  assert.equal(listingRes.data.listing.material_name, 'Cardboard');
  assert.equal(listingRes.data.listing.recycler_name, 'Ace Recyclers Ltd');
  assert.equal(listingRes.data.listing.photo_file, 'data:image/jpeg;base64,mockScannedImage');
});
