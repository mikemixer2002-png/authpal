'use strict';

// Tests for the upgrade package: MCP server, single-use passes (maxUses),
// seller check, and PayPal capture completion.
//
// Env is set BEFORE requiring the app so the app boots on a throwaway
// data file in demo mode (no PayPal credentials).

const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'authpal-test-'));
process.env.DATA_FILE = path.join(tmpDir, 'db.json');
delete process.env.PAYPAL_CLIENT_ID;
delete process.env.PAYPAL_CLIENT_SECRET;

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createMandate,
  checkMandate,
  signToken,
} = require('../lib/mandate');
const paypal = require('../lib/paypal');

function freshDb() {
  return { mandates: [], ledger: [] };
}

function paidEntry(mandateId, amount = 10, paymentStatus = 'demo') {
  return {
    id: 'l_t' + Math.random().toString(16).slice(2),
    ts: new Date().toISOString(),
    mandateId,
    source: 'agent',
    item: 'Earlier purchase',
    amount,
    category: 'Office supplies',
    payee: 'OfficeMart',
    decision: 'allow',
    reasons: [],
    paymentStatus,
    paypalOrderId: null,
  };
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

// ---------- maxUses (unit) ----------

test('maxUses: a single-use pass refuses after its one paid purchase', () => {
  const db = freshDb();
  const m = makeMandate(db, { maxUses: 1 });
  assert.equal(check(db, m).allowed, true);

  // A verify-only check does not consume the use.
  db.ledger.push(paidEntry(m.id, 480, 'not_attempted'));
  assert.equal(check(db, m).allowed, true);

  // A completed payment does.
  db.ledger.push(paidEntry(m.id, 10));
  const r = check(db, m);
  assert.equal(r.allowed, false);
  assert.match(r.reasons.join(' '), /single-use/);
});

test('maxUses above 1 allows exactly that many purchases', () => {
  const db = freshDb();
  const m = makeMandate(db, { maxUses: 2 });
  db.ledger.push(paidEntry(m.id));
  assert.equal(check(db, m).allowed, true);
  db.ledger.push(paidEntry(m.id));
  const r = check(db, m);
  assert.equal(r.allowed, false);
  assert.match(r.reasons.join(' '), /allows 2 purchases per month/);
});

test('maxUses defaults to null and stays unlimited', () => {
  const db = freshDb();
  const m = makeMandate(db);
  assert.equal(m.maxUses, null);
  for (let i = 0; i < 5; i++) db.ledger.push(paidEntry(m.id));
  assert.equal(check(db, m).allowed, true);

  // Records written before maxUses existed (no field at all) still work.
  delete m.maxUses;
  assert.equal(check(db, m).allowed, true);

  // And nonsense values are refused at creation.
  assert.throws(() => makeMandate(freshDb(), { maxUses: 0 }), /maxUses/);
  assert.throws(() => makeMandate(freshDb(), { maxUses: 1.5 }), /maxUses/);
});

test('old tokens without maxUses in the payload still verify', () => {
  const db = freshDb();
  const m = makeMandate(db, { maxUses: 1 });
  // Rebuild a pre-upgrade token: same fields the signer used to emit,
  // with no maxUses anywhere in the payload.
  const oldToken = signToken({
    mid: m.id,
    grantor: m.grantorName,
    agent: m.agentLabel,
    perTxCap: m.perTxCap,
    monthlyCap: m.monthlyCap,
    categories: m.categories,
    payees: m.payees,
    iat: Math.floor(new Date(m.createdAt).getTime() / 1000),
    exp: Math.floor(new Date(m.expiresAt).getTime() / 1000),
  });
  const r = checkMandate(db, {
    token: oldToken,
    amount: 25,
    category: 'Office supplies',
    payee: 'OfficeMart',
  });
  assert.equal(r.allowed, true);
});

// ---------- capture (unit, demo mode) ----------

test('captureOrder fails gracefully when PayPal is not configured', async () => {
  const r = await paypal.captureOrder('ANYORDERID');
  assert.equal(r.ok, false);
  assert.match(r.error, /demo mode/);
});

// ---------- HTTP: MCP, seller page, capture route ----------

let server = null;
let base = null;

async function startServer() {
  if (server) return;
  const app = require('../app');
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  server.unref();
  base = `http://127.0.0.1:${server.address().port}`;
}

test.after(() => {
  if (server) server.close();
});

async function rpc(method, params, id = 1) {
  const res = await fetch(base + '/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function callTool(name, args) {
  const { body } = await rpc('tools/call', { name, arguments: args });
  assert.ok(body && body.result, `no result for ${name}: ${JSON.stringify(body)}`);
  return body.result;
}

function toolJson(result) {
  return JSON.parse(result.content[0].text);
}

test('MCP: initialize, ping, tools/list, and protocol errors', async () => {
  await startServer();

  const init = await rpc('initialize', { protocolVersion: '2024-11-05' });
  assert.equal(init.body.result.serverInfo.name, 'authpal');
  assert.equal(init.body.result.protocolVersion, '2024-11-05');
  assert.ok(init.body.result.capabilities.tools !== undefined);

  const ping = await rpc('ping');
  assert.deepEqual(ping.body.result, {});

  const list = await rpc('tools/list');
  const names = list.body.result.tools.map((t) => t.name);
  assert.deepEqual(names, ['grant_pass', 'check_purchase', 'pay_with_pass', 'revoke_pass']);
  for (const t of list.body.result.tools) {
    assert.equal(t.inputSchema.type, 'object');
  }

  const unknown = await rpc('no/such-method');
  assert.equal(unknown.body.error.code, -32601);

  const badTool = await rpc('tools/call', { name: 'nope', arguments: {} });
  assert.equal(badTool.body.error.code, -32602);

  // A notification (no id) is accepted with no body back.
  const note = await fetch(base + '/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  assert.equal(note.status, 202);
});

test('MCP: grant, check, pay, revoke round trip writes the ledger', async () => {
  await startServer();

  const granted = toolJson(
    await callTool('grant_pass', {
      grantorName: 'Jamie Chen',
      agentLabel: 'StockBot',
      perTxCap: 100,
      monthlyCap: 500,
      categories: 'Office supplies',
    })
  );
  const mandate = granted.mandate;
  assert.ok(mandate.id);
  assert.ok(mandate.token.includes('.'));

  const checked = toolJson(
    await callTool('check_purchase', {
      token: mandate.token,
      amount: 25,
      category: 'Office supplies',
      payee: 'OfficeMart',
      item: 'Printer paper',
    })
  );
  assert.equal(checked.allowed, true);
  assert.equal(checked.mandateId, mandate.id);

  const paid = toolJson(
    await callTool('pay_with_pass', {
      mandateId: mandate.id,
      amount: 25,
      category: 'Office supplies',
      payee: 'OfficeMart',
      item: 'Printer paper',
    })
  );
  assert.equal(paid.allowed, true);
  assert.equal(paid.payment.status, 'demo'); // no PayPal credentials in tests

  const ledger = await (await fetch(base + '/api/ledger')).json();
  const mine = ledger.filter((e) => e.mandateId === mandate.id);
  assert.equal(mine.length, 2);
  assert.equal(mine[0].source, 'mcp');
  assert.equal(mine[0].paymentStatus, 'not_attempted');
  assert.equal(mine[1].paymentStatus, 'demo');

  const refused = toolJson(
    await callTool('pay_with_pass', {
      token: mandate.token,
      amount: 1299,
      category: 'Electronics',
      payee: 'TechSupply Co',
      item: 'Laptop',
    })
  );
  assert.equal(refused.allowed, false);
  assert.match(refused.reasons.join(' '), /per-purchase cap/);

  const revoked = toolJson(await callTool('revoke_pass', { mandateId: mandate.id }));
  assert.equal(revoked.status, 'revoked');

  const after = toolJson(
    await callTool('check_purchase', { token: mandate.token, amount: 10 })
  );
  assert.equal(after.allowed, false);
  assert.match(after.reasons.join(' '), /revoked/);
});

test('MCP: a single-use pass refuses its second pay_with_pass', async () => {
  await startServer();

  const granted = toolJson(
    await callTool('grant_pass', {
      grantorName: 'Sam Patel',
      agentLabel: 'OneShot',
      perTxCap: 100,
      monthlyCap: 500,
      categories: 'Office supplies',
      maxUses: 1,
    })
  );
  const mandate = granted.mandate;
  assert.equal(mandate.maxUses, 1);

  const args = {
    token: mandate.token,
    amount: 25,
    category: 'Office supplies',
    payee: 'OfficeMart',
    item: 'Notebooks',
  };
  const first = toolJson(await callTool('pay_with_pass', args));
  assert.equal(first.allowed, true);

  const second = toolJson(await callTool('pay_with_pass', args));
  assert.equal(second.allowed, false);
  assert.match(second.reasons.join(' '), /single-use/);
});

test('seller page renders in the shared layout and posts to /api/verify', async () => {
  await startServer();

  const res = await fetch(base + '/seller');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Seller check/);
  assert.match(html, /A pass works anywhere/);
  assert.match(html, /\/api\/verify/);

  const home = await (await fetch(base + '/')).text();
  assert.match(home, /href="\/seller"/);
  assert.match(home, /grant_pass/); // the quiet MCP section
});

test('capture route answers a clean JSON error for an unknown order', async () => {
  await startServer();
  const res = await fetch(base + '/api/orders/DOESNOTEXIST/capture', { method: 'POST' });
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.match(body.error, /No ledger entry/);
});
