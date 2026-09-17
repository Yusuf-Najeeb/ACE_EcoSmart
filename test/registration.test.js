import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';
import { createEmailProvider, AppError } from '../email.js';
import { DatabaseSync } from 'node:sqlite';
import { openStorage } from '../storage.js';

const details = { role: 'generator', name: 'Test Person', email: ' Person@Example.com ', area: 'Ikeja' };
async function fixture(t, options = {}) {
  let time = Date.now();
  // Provider doubles are confined to automated tests. The running app always uses the real email provider.
  const messages = [];
  const provider = { configured: true, send: async (email, code) => { messages.push({ email, code }); return 'email_test'; }, ...options.provider };
  const app = createApp({ demoPayments: true, dbPath: ':memory:', now: () => time, ...options, provider, origin: 'http://localhost:3000' });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); app.db.close(); });
  let cookie = '';
  async function request(path, data, headers = {}) {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}${path}`, { method: data === undefined ? 'GET' : 'POST', headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json', Cookie: cookie, ...headers }, body: data === undefined ? undefined : JSON.stringify(data) });
    const jar = Object.fromEntries(cookie.split('; ').filter(Boolean).map(x => x.split('=')));
    for (const item of response.headers.getSetCookie()) { const [key, value] = item.split(';')[0].split('='); jar[key] = value; }
    cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    return { status: response.status, data: await response.json(), headers: response.headers };
  }
  return { ...app, request, messages, get code() { return messages.at(-1)?.code; }, get wrongCode() { return String((Number(messages.at(-1)?.code) + 1) % 1000000).padStart(6, '0'); }, advance: ms => time += ms };
}
test('both roles register only after verification, persist correctly, and sign out', async t => {
  for (const role of ['generator', 'recycler']) await t.test(role, async t => {
    const app = await fixture(t);
    assert.equal((await app.request('/api/register', { ...details, role })).status, 200);
    assert.equal(app.db.prepare('SELECT count(*) AS n FROM users').get().n, 0);
    assert.equal((await app.request('/api/verify', { code: app.wrongCode })).status, 400);
    const verified = await app.request('/api/verify', { code: app.code });
    assert.equal(verified.status, 200);
    assert.equal(verified.data.user.email, 'person@example.com');
    assert.equal(verified.data.user.accountStatus, role === 'recycler' ? 'pending recycler approval' : 'active');
    assert.match(verified.headers.get('set-cookie'), /HttpOnly/);
    assert.equal((await app.request('/api/state')).data.user.role, role);
    assert.equal(app.db.prepare('SELECT status FROM registrations').get().status, 'verified');
    assert.equal((await app.request('/api/verify', { code: app.code })).status, 401);
    assert.equal((await app.request('/api/register', { ...details, role })).status, 409);
    await app.request('/api/logout', {});
    assert.equal((await app.request('/api/state')).data.user, null);
  });
});
test('validation, forged origins, and missing sessions cannot register or verify', async t => {
  const app = await fixture(t);
  for (const change of [{ role: 'administrator' }, { name: ' ' }, { area: '' }, { email: 'abc' }, { email: 'a..b@example.com' }, { email: 'a@-example.com' }, { email: 'a@example.com\r\nBcc:x@example.com' }]) assert.equal((await app.request('/api/register', { ...details, ...change })).status, 400);
  assert.equal((await app.request('/api/register', details, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await app.request('/api/verify', { code: app.code })).status, 401);
  assert.equal((await app.request('/api/state', undefined, { Cookie: 'eco_session=forged' })).data.user, null);
});
test('resend cooldown, expiry and attempt exhaustion require a fresh code', async t => {
  const app = await fixture(t);
  await app.request('/api/register', details);
  assert.equal((await app.request('/api/resend', {})).status, 429);
  app.advance(600001);
  assert.equal((await app.request('/api/verify', { code: app.code })).status, 410);
  assert.equal((await app.request('/api/resend', {})).status, 200);
  for (let i = 0; i < 5; i++) assert.equal((await app.request('/api/verify', { code: app.wrongCode })).status, 400);
  assert.equal((await app.request('/api/verify', { code: app.code })).status, 410);
  app.advance(60001);
  assert.equal((await app.request('/api/resend', {})).status, 200);
  assert.equal((await app.request('/api/verify', { code: app.code })).status, 200);
});
test('unconfigured and failed email services never create accounts', async t => {
  for (const provider of [{ configured: false }, { configured: true, send: async () => { throw new AppError(503, 'Service unavailable'); } }]) {
    const app = await fixture(t, { provider });
    assert.equal((await app.request('/api/register', details)).status, 503);
    assert.equal(app.db.prepare('SELECT count(*) AS n FROM users').get().n, 0);
  }
});
test('accounts and sessions survive a database reopen', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ecosmart-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'test.sqlite');
  let sentCode;
  const app = createApp({ demoPayments: true, dbPath: path, provider: { configured: true, send: async (_, code) => { sentCode = code; return 'email_test'; } } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const headers = { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' };
  const registration = await fetch(base + '/api/register', { method: 'POST', headers, body: JSON.stringify(details) });
  const pendingCookie = registration.headers.getSetCookie()[0].split(';')[0];
  const verification = await fetch(base + '/api/verify', { method: 'POST', headers: { ...headers, Cookie: pendingCookie }, body: JSON.stringify({ code: sentCode }) });
  assert.equal(verification.status, 200);
  const sessionCookie = verification.headers.getSetCookie()[0].split(';')[0];
  await new Promise(resolve => app.server.close(resolve)); app.db.close();
  const reopened = createApp({ demoPayments: true, dbPath: path });
  await new Promise(resolve => reopened.server.listen(0, '127.0.0.1', resolve));
  try {
    assert.equal(reopened.db.prepare('SELECT name FROM users').get().name, details.name);
    const state = await fetch(`http://127.0.0.1:${reopened.server.address().port}/api/state`, { headers: { Cookie: sessionCookie } });
    assert.equal((await state.json()).user.name, details.name);
  } finally { await new Promise(resolve => reopened.server.close(resolve)); reopened.db.close(); }
});

test('resends invalidate the previous code and no code is exposed through API or stored plaintext', async t => {
  const app = await fixture(t);
  const result = await app.request('/api/register', details);
  const firstCode = app.code;
  assert.match(firstCode, /^\d{6}$/);
  assert.equal(result.data.code, undefined);
  const row = app.db.prepare('SELECT * FROM registrations').get();
  assert.match(row.code_hash, /^[a-f0-9]{64}$/);
  assert.equal(Object.values(row).includes(firstCode), false);
  app.advance(60001);
  await app.request('/api/resend', {});
  // A code is scoped to its issuance; random values may rarely repeat.
  if (app.code !== firstCode) assert.equal((await app.request('/api/verify', { code: firstCode })).status, 400);
  assert.equal((await app.request('/api/verify', { code: app.code })).status, 200);
  assert.equal(app.db.prepare('SELECT code_hash FROM registrations').get().code_hash, null);
});

test('failed resend cannot validate the previous issuance', async t => {
  let count = 0; let code;
  const app = await fixture(t, { provider: { send: async (_, value) => {
    if (++count > 1) throw new AppError(503, 'Service unavailable');
    code = value; return 'email_test';
  } } });
  await app.request('/api/register', details);
  app.advance(60001);
  assert.equal((await app.request('/api/resend', {})).status, 503);
  assert.equal((await app.request('/api/verify', { code })).status, 410);
});

test('pending verification survives restart with its persisted HMAC key', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ecosmart-pending-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'test.sqlite');
  let code;
  const first = createApp({ demoPayments: true, dbPath, provider: { configured: true, send: async (_, value) => { code = value; return 'mail'; } } });
  await new Promise(resolve => first.server.listen(0, '127.0.0.1', resolve));
  const headers = { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' };
  const response = await fetch(`http://127.0.0.1:${first.server.address().port}/api/register`, { method: 'POST', headers, body: JSON.stringify(details) });
  const cookie = response.headers.getSetCookie()[0].split(';')[0];
  await new Promise(resolve => first.server.close(resolve)); first.db.close();
  const second = createApp({ demoPayments: true, dbPath });
  await new Promise(resolve => second.server.listen(0, '127.0.0.1', resolve));
  try {
    const verified = await fetch(`http://127.0.0.1:${second.server.address().port}/api/verify`, { method: 'POST', headers: { ...headers, Cookie: cookie }, body: JSON.stringify({ code }) });
    assert.equal(verified.status, 200);
  } finally { await new Promise(resolve => second.server.close(resolve)); second.db.close(); }
});

test('SMS migration preserves records and foreign keys without granting email verification', t => {
  const dir = mkdtempSync(join(tmpdir(), 'ecosmart-migration-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'test.sqlite');
  const old = new DatabaseSync(path);
  old.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY, phone TEXT NOT NULL);
    CREATE TABLE registrations(id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id));
    CREATE TABLE sessions(id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id));
    CREATE TABLE limits(key TEXT PRIMARY KEY);
    INSERT INTO users VALUES ('old-user','+2348012345678');
    INSERT INTO registrations VALUES ('old-registration','old-user');
    INSERT INTO sessions VALUES ('old-session','old-user');`);
  old.close();
  const migrated = openStorage(path);
  assert.equal(migrated.prepare('SELECT phone FROM legacy_sms_users').get().phone, '+2348012345678');
  assert.equal(migrated.prepare('SELECT count(*) AS n FROM users').get().n, 0);
  assert.equal(migrated.prepare('SELECT count(*) AS n FROM sessions').get().n, 0);
  assert.deepEqual(migrated.prepare('PRAGMA foreign_key_check').all(), []);
  migrated.close();
  const reopened = openStorage(path);
  assert.equal(reopened.prepare('SELECT count(*) AS n FROM legacy_sms_users').get().n, 1);
  reopened.close();
});

test('Brevo adapter submits the email and handles unavailable, rejected and rate-limited delivery', async () => {
  const calls = [];
  const env = { BREVO_API_KEY: 'test-only', EMAIL_FROM: 'EcoSmart <verify@example.com>' };
  const provider = createEmailProvider(env, async (url, options) => { calls.push({ url, options }); return new Response(JSON.stringify({ messageId: 'mail-id' }), { status: 201 }); });
  assert.equal(await provider.send('person@example.com', '123456', 'request-id'), 'mail-id');
  assert.equal(calls[0].url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(calls[0].options.headers['api-key'], 'test-only');
  assert.equal(calls[0].options.headers['X-Request-Id'], 'request-id');
  const payload = JSON.parse(calls[0].options.body);
  assert.deepEqual(payload.sender, { name: 'EcoSmart', email: 'verify@example.com' });
  assert.deepEqual(payload.to, [{ email: 'person@example.com' }]);
  assert.match(payload.textContent, /123456/);
  for (const [status, expected] of [[403, 503], [429, 429], [500, 503]]) {
    const failed = createEmailProvider(env, async () => new Response('{}', { status }));
    await assert.rejects(failed.send('person@example.com', '123456', 'id'), error => error.status === expected);
  }
  await assert.rejects(createEmailProvider({}).send('person@example.com', '123456', 'id'), error => error.status === 503);
});

