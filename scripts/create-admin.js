import { randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStorage } from '../storage.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env.DB_PATH || resolve(root, 'data/ecosmart.sqlite');
const db = openStorage(dbPath);

const args = process.argv.slice(2);

if (args.includes('--list') || args.includes('-l')) {
  const admins = db.prepare("SELECT id, name, email, role, account_status, created_at FROM users WHERE role='administrator'").all();
  console.log('\n--- Active EcoSmart Administrators ---');
  if (admins.length === 0) {
    console.log('No administrators found in database.');
  } else {
    admins.forEach((a, i) => {
      console.log(`${i + 1}. ${a.name} (${a.email}) - ID: ${a.id} [${a.account_status}]`);
    });
  }
  console.log('-------------------------------------\n');
  process.exit(0);
}

const email = (args[0] || '').trim().toLowerCase();
const name = (args[1] || 'EcoSmart Administrator').trim();
const area = (args[2] || 'Headquarters, Lagos').trim();

if (!email || !email.includes('@')) {
  console.log(`
Usage:
  node scripts/create-admin.js <email> [fullName] [area]
  node scripts/create-admin.js --list

Examples:
  node scripts/create-admin.js yusnaj21@yahoo.com "Najeeb Yusuf" "Ikeja, Lagos"
  npm run create-admin -- yusnaj21@yahoo.com
  `);
  process.exit(1);
}

const now = Date.now();
const existing = db.prepare('SELECT * FROM users WHERE email=?').get(email);

if (existing) {
  db.prepare(`
    UPDATE users 
    SET role='administrator', name=COALESCE(NULLIF(?, ''), name), area=COALESCE(NULLIF(?, ''), area), verification_status='verified', account_status='active', updated_at=?
    WHERE email=?
  `).run(name, area, now, email);

  console.log(`\n✓ User "${email}" has been successfully promoted to Administrator!`);
  console.log(`  Name: ${name || existing.name}`);
  console.log(`  Role: administrator`);
  console.log(`  Status: active\n`);
} else {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO users (id, role, name, email, area, verification_status, account_status, created_at, updated_at)
    VALUES (?, 'administrator', ?, ?, ?, 'verified', 'active', ?, ?)
  `).run(id, name, email, area, now, now);

  console.log(`\n✓ New Administrator created successfully!`);
  console.log(`  ID: ${id}`);
  console.log(`  Name: ${name}`);
  console.log(`  Email: ${email}`);
  console.log(`  Role: administrator`);
  console.log(`  Area: ${area}\n`);
}
