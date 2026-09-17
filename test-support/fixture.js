import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { createApp } from '../server.js';

export async function fixture(t, options = {}) {
  let time = Date.now();
  const app = createApp({ dbPath: ':memory:', now: () => time, provider: { configured: false }, origin: 'http://localhost:3000', ...options });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); app.db.close(); });
  function client(role) {
    let cookie = '', id;
    if (role) {
      id = randomUUID();
      app.db.prepare("INSERT INTO users VALUES (?, ?, 'Test User', ?, 'Ikeja, Lagos', 'verified', 'active', ?, ?)").run(id, role, `${id}@example.test`, time, time);
      const token = randomBytes(32).toString('hex');
      app.db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(createHash('sha256').update(token).digest('hex'), id, time + 7 * 86400000);
      cookie = `eco_session=${token}`;
    }
    return { id, async request(path, data) {
      const response = await fetch(`http://127.0.0.1:${app.server.address().port}${path}`, {
        method: data === undefined ? 'GET' : 'POST', headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json', Cookie: cookie }, body: data === undefined ? undefined : JSON.stringify(data)
      });
      return { status: response.status, data: await response.json() };
    } };
  }
  return { ...app, client, advance: ms => time += ms };
}

export async function marketplace(env) {
  const rec = env.client('recycler'), gen = env.client('generator'), admin = env.client('administrator');
  const application = await rec.request('/api/recycler/application', {
    businessName: 'Test Recycler', contactPhone: '+2348029998888', businessAddress: '10 Test Road',
    govIdType: 'National Identity Number (NIN)', govIdNumber: '11122233344', govIdFile: 'data:image/png;base64,id', photoFile: 'data:image/png;base64,photo',
    licenceType: 'CAC Business Registration', licenceNumber: 'RC-111222', licenceFile: 'data:image/png;base64,lic', area: 'Ikeja, Lagos'
  });
  const applicationId = application.data.application.id;
  await admin.request('/api/admin/review-application', { applicationId, decision: 'approved' });
  await rec.request('/api/recycler/settings', { settings: [{ materialId: 'cardboard', accepted: true, price: 200, unit: 'per kilogram' }] });
  const listingInput = { recyclerId: rec.id, materialId: 'cardboard', description: 'Clean cardboard', declaredQuantity: 10, quantityUnit: 'kg', locationAddress: 'Ikeja, Lagos', preferredArrangement: 'pickup' };
  const listing = await gen.request('/api/generator/listings', listingInput);
  const listingId = listing.data.listing.id;
  await rec.request('/api/recycler/listings/respond', { listingId, decision: 'accepted', agreedArrangement: 'pickup' });
  return { rec, gen, admin, applicationId, listingId, listingInput };
}
