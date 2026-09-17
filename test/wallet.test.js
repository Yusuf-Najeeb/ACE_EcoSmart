import { adminRequest, seedWallet } from '../test-support/admin.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server.js';
import { openStorage } from '../storage.js';

const generatorDetails = { role: 'generator', name: 'Alaba Generator', email: 'gen_wallet@ecosmart.ng', area: 'Ikeja, Lagos' };
const recyclerDetails = { role: 'recycler', name: 'Apex Recyclers Ltd', email: 'rec_wallet@ecosmart.ng', area: 'Ikeja, Lagos' };
const adminDetails = { role: 'recycler', name: 'Admin Officer', email: 'admin_test@ecosmart.ng', area: 'HQ, Lagos' };

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

test('Wallet initialization, top-up, and bank account linking for Recycler and Generator', async t => {
  const env = await fixture(t);
  const recClient = env.makeClient();
  const genClient = env.makeClient();

  // 1. Setup Recycler
  await recClient.registerAndVerify(recyclerDetails);
  await recClient.request('/api/recycler/application', {
    businessName: 'Apex Recyclers Ltd',
    contactPhone: '+234 802 999 8888',
    businessAddress: '10 Industrial Way, Ikeja',
    govIdType: 'National Identity Number (NIN)',
    govIdNumber: '99999999999',
    govIdFile: 'data:image/png;base64,govid',
    photoFile: 'data:image/png;base64,photo',
    licenceType: 'CAC Business Registration',
    licenceNumber: 'RC-888999',
    licenceFile: 'data:image/png;base64,lic',
    area: 'Ikeja, Lagos'
  });

  // Check initial wallet state for Recycler
  const recWalletRes = await recClient.request('/api/wallet');
  assert.equal(recWalletRes.status, 200);
  assert.equal(recWalletRes.data.wallet.available_balance, 0);
  assert.equal(recWalletRes.data.wallet.escrow_locked_balance, 0);
  assert.equal(recWalletRes.data.bankAccount, null);
  assert.equal(recWalletRes.data.walletTransactions.length, 0);

  // 2. Top-up Recycler Wallet by ₦50,000 via simulated transfer
  const topupRes = await recClient.request('/api/wallet/topup', {
    amount: 50000,
    channel: 'instant_transfer'
  });
  assert.equal(topupRes.status, 200);
  assert.equal(topupRes.data.wallet.available_balance, 50000);
  assert.equal(topupRes.data.walletTransactions.length, 1);
  assert.equal(topupRes.data.walletTransactions[0].type, 'topup');
  assert.equal(topupRes.data.walletTransactions[0].amount, 50000);

  // Top up another ₦25,000 via virtual account
  const topup2 = await recClient.request('/api/wallet/topup', {
    amount: 25000,
    channel: 'virtual_account'
  });
  assert.equal(topup2.status, 200);
  assert.equal(topup2.data.wallet.available_balance, 75000);

  // 3. Link Bank Account for Recycler
  const bankRes = await recClient.request('/api/wallet/bank-account', {
    bankCode: '058',
    bankName: 'Guaranty Trust Bank (GTBank)',
    accountNumber: '0123456789',
    accountName: 'APEX RECYCLERS LTD'
  });
  assert.equal(bankRes.status, 200);
  assert.equal(bankRes.data.bankAccount.bank_name, 'Guaranty Trust Bank (GTBank)');
  assert.equal(bankRes.data.bankAccount.account_number, '0123456789');

  // 4. Setup Generator and link Bank Account
  await genClient.registerAndVerify(generatorDetails);
  const genBankRes = await genClient.request('/api/wallet/bank-account', {
    bankCode: '044',
    bankName: 'Access Bank',
    accountNumber: '9876543210',
    accountName: 'ALABA GENERATOR'
  });
  assert.equal(genBankRes.status, 200);
  assert.equal(genBankRes.data.bankAccount.account_number, '9876543210');

  // Verify /api/state returns full wallet and bank details
  const genState = await genClient.request('/api/state');
  assert.equal(genState.data.wallet.available_balance, 0);
  assert.equal(genState.data.bankAccount.bank_name, 'Access Bank');
});

test('Full Escrow lifecycle: Recycler offer locks escrow -> Generator accepts -> 100% credited to Generator -> Generator withdraws to Bank', async t => {
  const env = await fixture(t);
  const adminClient = env.makeClient();
  const recClient = env.makeClient();
  const genClient = env.makeClient();

  // Admin registration & verification
  await adminClient.registerAndVerify(adminDetails);

  // Recycler setup and approval
  await recClient.registerAndVerify(recyclerDetails);
  const appRes = await recClient.request('/api/recycler/application', {
    businessName: 'Apex Recyclers Ltd',
    contactPhone: '+234 802 999 8888',
    businessAddress: '12 Factory Road, Ikeja',
    govIdType: 'National Identity Number (NIN)',
    govIdNumber: '11122233344',
    govIdFile: 'data:image/png;base64,id',
    photoFile: 'data:image/png;base64,photo',
    licenceType: 'CAC Business Registration',
    licenceNumber: 'RC-111222',
    licenceFile: 'data:image/png;base64,lic',
    area: 'Ikeja, Lagos'
  });
  const appId = appRes.data.application.id;
  const reviewRes = await adminRequest(env, '/api/admin/review-application', {
    applicationId: appId,
    decision: 'approved'
  });
  assert.equal(reviewRes.status, 200);

  // Configure recycler material settings
  await recClient.request('/api/recycler/settings', {
    settings: [{ materialId: 'cardboard', accepted: true, price: 200, unit: 'per kilogram' }]
  });

  // Recycler tops up wallet with ₦100,000
  await recClient.request('/api/wallet/topup', { amount: 100000 });

  // Generator creates listing for 500kg cardboard
  await genClient.registerAndVerify(generatorDetails);
  await genClient.request('/api/wallet/bank-account', {
    bankCode: '057',
    bankName: 'Zenith Bank',
    accountNumber: '2001234567',
    accountName: 'ALABA GENERATOR'
  });

  const listRes = await genClient.request('/api/generator/listings', {
    recyclerId: (await recClient.request('/api/state')).data.user.id,
    materialId: 'cardboard',
    description: 'Clean baled cardboard',
    declaredQuantity: 500,
    quantityUnit: 'kg',
    preferredArrangement: 'pickup',
    locationAddress: '25 Oba Akran Ave, Ikeja'
  });
  assert.equal(listRes.status, 200);
  const listingId = listRes.data.listing.id;

  // Recycler accepts listing
  await recClient.request('/api/recycler/listings/respond', {
    listingId,
    decision: 'accepted',
    agreedArrangement: 'pickup',
    arrangementNote: 'Pickup scheduled'
  });

  // Recycler inspects and submits final funded offer for ₦75,000 (375kg @ ₦200)
  const offerRes = await recClient.request('/api/recycler/inspection/submit-offer', {
    listingId,
    actualQuantity: 375,
    quantityUnit: 'kg',
    inspectionNotes: 'High grade cardboard weighed on digital scale',
    amount: 75000
  });
  assert.equal(offerRes.status, 200);

  // Check Recycler wallet balances: ₦25,000 available, ₦75,000 locked in escrow
  const recWalletAfterOffer = await recClient.request('/api/wallet');
  assert.equal(recWalletAfterOffer.data.wallet.available_balance, 25000);
  assert.equal(recWalletAfterOffer.data.wallet.escrow_locked_balance, 75000);

  // Generator accepts final offer
  const acceptRes = await genClient.request('/api/generator/offer/decision', {
    listingId,
    decision: 'accept'
  });
  assert.equal(acceptRes.status, 200);

  // Check Recycler wallet: escrow cleared (locked = 0, available = 25,000, total spent = 75,000)
  const recWalletFinal = await recClient.request('/api/wallet');
  assert.equal(recWalletFinal.data.wallet.available_balance, 25000);
  assert.equal(recWalletFinal.data.wallet.escrow_locked_balance, 0);
  assert.equal(recWalletFinal.data.lifetimeTotal, 75000);

  // Check Generator wallet: ₦75,000 available earnings (100% payout, ₦0 fee)
  const genWalletFinal = await genClient.request('/api/wallet');
  assert.equal(genWalletFinal.data.wallet.available_balance, 75000);
  assert.equal(genWalletFinal.data.lifetimeTotal, 75000);
  assert.equal(genWalletFinal.data.walletTransactions[0].type, 'payout_credit');
  assert.equal(genWalletFinal.data.walletTransactions[0].amount, 75000);

  // Generator withdraws ₦50,000 to Zenith Bank
  const withdrawRes = await genClient.request('/api/wallet/withdraw', { amount: 50000 });
  assert.equal(withdrawRes.status, 200);
  assert.equal(withdrawRes.data.wallet.available_balance, 25000);
  assert.equal(withdrawRes.data.walletTransactions[0].type, 'withdrawal');
  assert.equal(withdrawRes.data.walletTransactions[0].amount, -50000);

  // Generator attempts to withdraw more than available balance (₦30,000 > ₦25,000) -> 400 error
  const overWithdraw = await genClient.request('/api/wallet/withdraw', { amount: 30000 });
  assert.equal(overWithdraw.status, 400);
  assert.match(overWithdraw.data.error, /Insufficient available balance/i);
});

test('Escrow reversal: Generator rejects offer -> escrow funds unlocked back to Recycler', async t => {
  const env = await fixture(t);
  const adminClient = env.makeClient();
  const recClient = env.makeClient();
  const genClient = env.makeClient();

  // Admin registration & verification
  await adminClient.registerAndVerify(adminDetails);

  await recClient.registerAndVerify(recyclerDetails);
  const appRes = await recClient.request('/api/recycler/application', {
    businessName: 'Apex Recyclers Ltd',
    contactPhone: '+234 802 999 8888',
    businessAddress: '55 Mobolaji Bank Anthony Way',
    govIdType: 'National Identity Number (NIN)',
    govIdNumber: '33344455566',
    govIdFile: 'data:image/png;base64,id',
    photoFile: 'data:image/png;base64,photo',
    licenceType: 'CAC Business Registration',
    licenceNumber: 'RC-333444',
    licenceFile: 'data:image/png;base64,lic',
    area: 'Ikeja, Lagos'
  });
  const reviewRes = await adminRequest(env, '/api/admin/review-application', {
    applicationId: appRes.data.application.id,
    decision: 'approved'
  });
  assert.equal(reviewRes.status, 200);

  await recClient.request('/api/recycler/settings', {
    settings: [{ materialId: 'cardboard', accepted: true, price: 150, unit: 'per kilogram' }]
  });

  // Recycler tops up ₦40,000
  await recClient.request('/api/wallet/topup', { amount: 40000 });

  // Generator creates listing
  await genClient.registerAndVerify(generatorDetails);
  const listRes = await genClient.request('/api/generator/listings', {
    recyclerId: (await recClient.request('/api/state')).data.user.id,
    materialId: 'cardboard',
    description: 'Sample cardboard',
    declaredQuantity: 200,
    quantityUnit: 'kg',
    preferredArrangement: 'drop-off',
    locationAddress: 'Ikeja'
  });
  assert.equal(listRes.status, 200);
  const listingId = listRes.data.listing.id;

  await recClient.request('/api/recycler/listings/respond', {
    listingId,
    decision: 'accepted',
    agreedArrangement: 'drop-off',
    arrangementNote: 'Dropoff ready'
  });

  // Recycler submits offer of ₦30,000 -> locks ₦30,000 in escrow
  await recClient.request('/api/recycler/inspection/submit-offer', {
    listingId,
    actualQuantity: 200,
    quantityUnit: 'kg',
    inspectionNotes: 'Weighed on scale',
    amount: 30000
  });

  const recLocked = await recClient.request('/api/wallet');
  assert.equal(recLocked.data.wallet.available_balance, 10000);
  assert.equal(recLocked.data.wallet.escrow_locked_balance, 30000);

  // Generator rejects offer
  const rejectRes = await genClient.request('/api/generator/offer/decision', {
    listingId,
    decision: 'reject',
    rejectionReason: 'Expected higher unit price per kg'
  });
  assert.equal(rejectRes.status, 200);

  // Recycler escrow deposit is unlocked back to available balance (₦40,000 total)
  const recUnlocked = await recClient.request('/api/wallet');
  assert.equal(recUnlocked.data.wallet.available_balance, 40000);
  assert.equal(recUnlocked.data.wallet.escrow_locked_balance, 0);
  assert.equal(recUnlocked.data.walletTransactions[0].type, 'escrow_unlock');
});

test('Wallet data persists across SQLite database restarts', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ecosmart-wallet-persist-'));
  const dbPath = join(dir, 'test-wallet.sqlite');

  const now = Date.now();
  const userId = randomUUID();
  const walletId = randomUUID();
  const bankAcctId = randomUUID();
  const txId = randomUUID();

  // Stage 1: Setup storage and make transactions
  const db1 = openStorage(dbPath);
  db1.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?)').run(
    userId, 'recycler', 'Persistent Recycler', 'persist@ecosmart.ng', 'Ikeja', 'verified', 'active', now, now
  );
  db1.prepare('INSERT INTO user_wallets VALUES (?,?,?,?,?,?,?)').run(
    walletId, userId, 85000, 0, 'NGN', now, now
  );
  db1.prepare('INSERT INTO wallet_transactions VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
    txId, userId, 'topup', 85000, 85000, null, 'TOPUP-PERSIST1', 'Wallet top-up', null, 'successful', now
  );
  db1.prepare('INSERT INTO user_bank_accounts VALUES (?,?,?,?,?,?,?,?)').run(
    bankAcctId, userId, '058', 'Guaranty Trust Bank (GTBank)', '0234567891', 'PERSISTENT RECYCLER', now, now
  );
  db1.close();

  // Stage 2: Reopen storage and verify all data is intact
  const db2 = openStorage(dbPath);
  const restoredWallet = db2.prepare('SELECT * FROM user_wallets WHERE user_id=?').get(userId);
  assert.equal(restoredWallet.available_balance, 85000);

  const restoredBank = db2.prepare('SELECT * FROM user_bank_accounts WHERE user_id=?').get(userId);
  assert.equal(restoredBank.bank_name, 'Guaranty Trust Bank (GTBank)');
  assert.equal(restoredBank.account_number, '0234567891');

  const restoredTx = db2.prepare('SELECT * FROM wallet_transactions WHERE user_id=?').all(userId);
  assert.equal(restoredTx.length, 1);
  assert.equal(restoredTx[0].amount, 85000);

  db2.close();
  rmSync(dir, { recursive: true, force: true });
});
