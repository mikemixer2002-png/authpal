'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createMandate,
  checkMandate,
  parseToken,
} = require('../lib/mandate');

function freshDb() {
  return { mandates: [], ledger: [] };
}

function makeMandate(db, overrides = {}) {
  return createMandate(db, {
    grantorName: 'Jordan Rivera',
    agentLabel: 'OfficeBot',
    perTxCap: 100,
    monthlyCap: 500,
    categories: 'Office supplies, Electronics',
    payees: '',
    expiryDays: 30,
    ...overrides,
  });
}

function check(db, mandate, overrides = {}) {
  return checkMandate(db, {
    token: mandate.token,
    amount: 25,
    category: 'Office supplies',
    payee: 'OfficeMart',
    ...overrides,
  });
}

test('happy path: a purchase inside every limit is allowed', () => {
  const db = freshDb();
  const m = makeMandate(db);
  const r = check(db, m);
  assert.equal(r.allowed, true);
  assert.deepEqual(r.reasons, []);
  assert.equal(r.mandateId, m.id);
});

test('signature tamper is rejected', () => {
  const db = freshDb();
  const m = makeMandate(db);
  // Flip the last character of the signature.
  const tamperedSig =
    m.token.slice(0, -1) + (m.token.endsWith('A') ? 'B' : 'A');
  const r1 = checkMandate(db, {
    token: tamperedSig,
    amount: 25,
    category: 'Office supplies',
    payee: 'OfficeMart',
  });
  assert.equal(r1.allowed, false);
  assert.match(r1.reasons.join(' '), /signature/i);

  // Tamper with the payload (raise the cap) without re-signing.
  const [, sig] = m.token.split('.');
  const payload = JSON.parse(Buffer.from(m.token.split('.')[0], 'base64url').toString());
  payload.perTxCap = 100000;
  const forged =
    Buffer.from(JSON.stringify(payload)).toString('base64url') + '.' + sig;
  const r2 = checkMandate(db, {
    token: forged,
    amount: 25,
    category: 'Office supplies',
    payee: 'OfficeMart',
  });
  assert.equal(r2.allowed, false);
  assert.equal(parseToken(forged).error, 'Invalid token signature');
});

test('over the per-purchase cap is refused', () => {
  const db = freshDb();
  const m = makeMandate(db);
  const r = check(db, m, { amount: 1299, category: 'Electronics', payee: 'TechSupply Co' });
  assert.equal(r.allowed, false);
  assert.match(r.reasons.join(' '), /per-purchase cap/);
});

test('monthly cap accumulation is refused', () => {
  const db = freshDb();
  const m = makeMandate(db);
  // Simulate $480 already spent this month in completed payments.
  db.ledger.push({
    id: 'l_test1',
    ts: new Date().toISOString(),
    mandateId: m.id,
    source: 'agent',
    item: 'Earlier purchase',
    amount: 480,
    category: 'Office supplies',
    payee: 'OfficeMart',
    decision: 'allow',
    reasons: [],
    paymentStatus: 'demo',
    paypalOrderId: null,
  });
  const r = check(db, m, { amount: 25 });
  assert.equal(r.allowed, false);
  assert.match(r.reasons.join(' '), /Monthly cap exceeded/);

  // A refused or not-yet-paid entry must NOT eat the monthly cap:
  const db2 = freshDb();
  const m2 = makeMandate(db2);
  db2.ledger.push({
    id: 'l_test2',
    ts: new Date().toISOString(),
    mandateId: m2.id,
    source: 'verify',
    item: '(API check)',
    amount: 480,
    category: 'Office supplies',
    payee: 'OfficeMart',
    decision: 'allow',
    reasons: [],
    paymentStatus: 'not_attempted',
    paypalOrderId: null,
  });
  const r2 = check(db2, m2, { amount: 25 });
  assert.equal(r2.allowed, true);
});

test('wrong category is refused (case-insensitive match allowed)', () => {
  const db = freshDb();
  const m = makeMandate(db);
  const r = check(db, m, { category: 'Travel', payee: 'SkyAir', amount: 50 });
  assert.equal(r.allowed, false);
  assert.match(r.reasons.join(' '), /not in the allowed categories/);

  const ok = check(db, m, { category: 'office supplies' });
  assert.equal(ok.allowed, true);
});

test('payee allowlist is enforced when set', () => {
  const db = freshDb();
  const m = makeMandate(db, { payees: 'OfficeMart, TechSupply Co' });
  const bad = check(db, m, { payee: 'SomeOtherShop' });
  assert.equal(bad.allowed, false);
  assert.match(bad.reasons.join(' '), /payee allowlist/i);

  const good = check(db, m, { payee: 'officemart' });
  assert.equal(good.allowed, true);

  // And with no allowlist, any payee passes that check.
  const db2 = freshDb();
  const m2 = makeMandate(db2);
  const any = check(db2, m2, { payee: 'Whoever' });
  assert.equal(any.allowed, true);
});

test('expired mandate is refused', () => {
  const db = freshDb();
  const m = makeMandate(db, { expiryDays: -1 }); // already expired
  const r = check(db, m);
  assert.equal(r.allowed, false);
  assert.match(r.reasons.join(' '), /expired/);
});

test('revoked mandate is refused', () => {
  const db = freshDb();
  const m = makeMandate(db);
  m.status = 'revoked';
  const r = check(db, m);
  assert.equal(r.allowed, false);
  assert.match(r.reasons.join(' '), /revoked/);
});

test('agent catalog plan: restock matches office items, laptop matches laptop', () => {
  const { planPurchase } = require('../lib/agent');
  const restock = planPurchase(
    'Restock the office: buy printer paper, coffee pods, notebooks and whiteboard markers'
  );
  assert.deepEqual(
    restock.map((i) => i.name),
    ['Printer paper', 'Coffee pods', 'Notebooks', 'Whiteboard markers']
  );
  const laptop = planPurchase('Buy a laptop for the new hire');
  assert.deepEqual(laptop.map((i) => i.name), ['Laptop']);
  assert.equal(planPurchase('Sing me a song').length, 0);
});
