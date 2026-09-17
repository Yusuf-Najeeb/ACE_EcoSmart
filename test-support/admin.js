import { randomUUID, randomBytes, createHash } from 'node:crypto';

// Test setup uses a separate administrator session, never a recycler's session.
export async function adminRequest(app, path, data) {
  const id = randomUUID(), token = randomBytes(32).toString('hex');
  app.db.prepare("INSERT INTO users VALUES (?, 'administrator', 'Test Administrator', ?, 'HQ', 'verified', 'active', 0, 0)").run(id, `${id}@example.test`);
  const sessionId = createHash('sha256').update(token).digest('hex');
  app.db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(sessionId, id, Number.MAX_SAFE_INTEGER);
  try {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}${path}`, {
      method: 'POST', headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json', Cookie: `eco_session=${token}` }, body: JSON.stringify(data)
    });
    return { status: response.status, data: await response.json() };
  } finally {
    app.db.prepare('DELETE FROM sessions WHERE id=?').run(sessionId);
  }
}

export function seedWallet(app, userId, amount = 1000000) {
  app.db.prepare("INSERT INTO user_wallets (id,user_id,available_balance,escrow_locked_balance,currency,created_at,updated_at) VALUES (?,?,?,0,'NGN',0,0) ON CONFLICT(user_id) DO UPDATE SET available_balance=excluded.available_balance").run(randomUUID(), userId, amount);
}
