import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';
import { openStorage } from '../storage.js';

const generatorDetails = { role: 'generator', name: 'Generator Person', email: 'generator@ecosmart.ng', area: 'Ikeja, Lagos' };
const recyclerDetails = { role: 'recycler', name: 'Recycler Person', email: 'recycler@ecosmart.ng', area: 'Ikeja, Lagos' };

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

test('Generator receives pilot materials and can record supported material intake', async t => {
  const app = await fixture(t);

  // 1. Register & verify as generator
  const verified = await app.registerAndVerify(generatorDetails);
  assert.equal(verified.status, 200);
  assert.equal(verified.data.user.role, 'generator');

  // 2. Fetch state: includes 5 pilot materials and empty intake history
  const state = await app.request('/api/state');
  assert.equal(state.status, 200);
  assert.equal(state.data.materials.length, 5);
  const materialIds = state.data.materials.map(m => m.id);
  assert.deepEqual(materialIds, ['cardboard', 'pet_plastic_bottles', 'aluminium', 'brass', 'glass']);
  assert.deepEqual(state.data.intakes, []);

  // 3. Record supported intake for Cardboard
  const intakeRes = await app.request('/api/generator/intake', {
    materialId: 'cardboard',
    materialName: 'Cardboard',
    recyclable: true,
    guidanceTip: 'Keep dry and flatten boxes.',
    outcome: 'continued to matching'
  });

  assert.equal(intakeRes.status, 200);
  assert.equal(intakeRes.data.intake.material_id, 'cardboard');
  assert.equal(intakeRes.data.intake.material_name, 'Cardboard');
  assert.equal(intakeRes.data.intake.recyclable, 1);
  assert.equal(intakeRes.data.intake.outcome, 'continued to matching');
  assert.equal(intakeRes.data.intakes.length, 1);

  // 4. Fetch state: returns updated intake history
  const updatedState = await app.request('/api/state');
  assert.equal(updatedState.data.intakes.length, 1);
  assert.equal(updatedState.data.intakes[0].material_id, 'cardboard');
});

test('Generator can record unsupported material intake with feedback', async t => {
  const app = await fixture(t);

  // Register & verify as generator
  await app.registerAndVerify(generatorDetails);

  // Record unsupported intake
  const intakeRes = await app.request('/api/generator/intake', {
    materialId: 'unsupported',
    materialName: 'Other / Non-pilot Material',
    recyclable: false,
    guidanceTip: 'Not accepted in this pilot.',
    outcome: 'not supported in this pilot'
  });

  assert.equal(intakeRes.status, 200);
  assert.equal(intakeRes.data.intake.material_id, null);
  assert.equal(intakeRes.data.intake.recyclable, 0);
  assert.equal(intakeRes.data.intake.outcome, 'not supported in this pilot');
});

test('Intake endpoint rejects unauthenticated or non-generator requests', async t => {
  const app = await fixture(t);

  // 1. Unauthenticated request
  const unauthRes = await app.request('/api/generator/intake', {
    materialId: 'cardboard',
    materialName: 'Cardboard',
    recyclable: true
  });
  assert.equal(unauthRes.status, 401);

  // 2. Recycler role request
  await app.registerAndVerify(recyclerDetails);
  const recyclerRes = await app.request('/api/generator/intake', {
    materialId: 'cardboard',
    materialName: 'Cardboard',
    recyclable: true
  });
  assert.equal(recyclerRes.status, 403);
});

test('Photo names and hints never claim image recognition', async t => {
  const app = await fixture(t);
  await app.registerAndVerify(generatorDetails);
  for (const filename of ['glass.jpg', 'cardboard.png', 'battery.jpg', 'snapshot_001.png']) {
    const res = await app.request('/api/generator/intake-analyze', { filename, textHint: 'glass', photoFile: 'data:image/png;base64,not-an-image' });
    assert.equal(res.status, 200);
    assert.equal(res.data.detected, false);
    assert.equal(res.data.materialId, null);
    assert.equal(res.data.confidence, 'unavailable');
    assert.match(res.data.guidance, /manually/);
  }
});

test('Generator can record intake via scan and photo upload with photoFile attached', async t => {
  const app = await fixture(t);
  await app.registerAndVerify(generatorDetails);

  // 1. Submit photo upload intake
  const photoRes = await app.request('/api/generator/intake', {
    materialId: 'pet_plastic_bottles',
    materialName: 'PET Plastic Bottles',
    intakeMethod: 'photo upload',
    photoFile: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    recyclable: true,
    guidanceTip: 'Empty liquid, rinse, and crush bottles.',
    outcome: 'continued to matching'
  });
  assert.equal(photoRes.status, 200);
  assert.equal(photoRes.data.intake.intake_method, 'photo upload');
  assert.ok(photoRes.data.intake.photo_file);

  // 2. Submit scan intake
  const scanRes = await app.request('/api/generator/intake', {
    materialId: 'aluminium',
    materialName: 'Aluminium Cans',
    intakeMethod: 'scan',
    photoFile: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    recyclable: true,
    guidanceTip: 'Rinse cans and remove foreign debris.',
    outcome: 'continued to matching'
  });
  assert.equal(scanRes.status, 200);
  assert.equal(scanRes.data.intake.intake_method, 'scan');
  assert.ok(scanRes.data.intake.photo_file);

  // 3. State returns all intakes with method and photo
  const state = await app.request('/api/state');
  assert.equal(state.data.intakes.length, 2);
  assert.equal(state.data.intakes[0].intake_method, 'scan');
  assert.equal(state.data.intakes[1].intake_method, 'photo upload');
});

test('Generator material intake persists across database restarts', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ecosmart-intake-test-'));
  const dbPath = join(dir, 'test.db');
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  let cookie = '';
  let sentCode = '';
  // Instance 1
  {
    const app = createApp({ demoPayments: true,
      dbPath,
      origin: 'http://localhost:3000',
      provider: {
        configured: true,
        send: async (email, code) => {
          sentCode = code;
          return 'ok';
        }
      }
    });
    await new Promise(r => app.server.listen(0, '127.0.0.1', r));
    
    // Register generator
    const regRes = await fetch(`http://127.0.0.1:${app.server.address().port}/api/register`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
      body: JSON.stringify(generatorDetails)
    });
    for (const item of regRes.headers.getSetCookie()) {
      if (item.startsWith('eco_pending=')) cookie = item.split(';')[0];
    }
    
    const verifyRes = await fetch(`http://127.0.0.1:${app.server.address().port}/api/verify`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ code: sentCode })
    });
    for (const item of verifyRes.headers.getSetCookie()) {
      if (item.startsWith('eco_session=')) cookie = item.split(';')[0];
    }

    // Submit intake with photo upload method
    await fetch(`http://127.0.0.1:${app.server.address().port}/api/generator/intake`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        materialId: 'pet_plastic_bottles',
        materialName: 'PET Plastic Bottles',
        intakeMethod: 'photo upload',
        photoFile: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        recyclable: true,
        guidanceTip: 'Empty liquid, rinse, and crush bottles.',
        outcome: 'continued to matching'
      })
    });

    await new Promise(r => app.server.close(r));
    app.db.close();
  }

  // Instance 2 (Verify records in reopened DB)
  {
    const storage = openStorage(dbPath);
    const intakes = storage.prepare('SELECT * FROM material_intakes').all();
    assert.equal(intakes.length, 1);
    assert.equal(intakes[0].material_id, 'pet_plastic_bottles');
    assert.equal(intakes[0].material_name, 'PET plastic bottles');
    assert.equal(intakes[0].intake_method, 'photo upload');
    assert.ok(intakes[0].photo_file);
    assert.equal(intakes[0].recyclable, 1);
    assert.equal(intakes[0].outcome, 'continued to matching');
    storage.close();
  }
});
