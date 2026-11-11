'use strict';

// Mandates: creation, HMAC-signed tokens, and the permission check that runs
// BEFORE any money moves.
//
// Token format:  base64url(JSON payload) "." base64url(HMAC-SHA256(payload))
// Payload:       { mid, grantor, agent, perTxCap, monthlyCap, categories,
//                  payees, iat, exp }   (times are unix seconds)
//
// The stored mandate record is the source of truth for status
// (active / revoked); the token carries the limits.

const crypto = require('crypto');

const SECRET = process.env.MANDATE_SECRET || 'mandate-dev-secret-change-me';

// Ledger payment statuses that count as real spend against the monthly cap.
const PAID_STATUSES = ['captured', 'order_created', 'demo'];

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signToken(payload) {
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}

// Returns { payload } on success, { error } on any problem.
function parseToken(token) {
  if (!token || typeof token !== 'string') return { error: 'Missing token' };
  const parts = token.split('.');
  if (parts.length !== 2) return { error: 'Malformed token' };
  const [body, sig] = parts;
  const expected = crypto
    .createHmac('sha256', SECRET)
    .update(body)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { error: 'Invalid token signature' };
  }
  try {
    return { payload: JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) };
  } catch {
    return { error: 'Malformed token payload' };
  }
}

function splitList(value) {
  if (Array.isArray(value)) return value.map((s) => String(s).trim()).filter(Boolean);
  if (typeof value === 'string')
    return value.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

function createMandate(db, fields) {
  const perTxCap = Number(fields.perTxCap);
  const monthlyCap = Number(fields.monthlyCap);
  const expiryDays = fields.expiryDays === undefined || fields.expiryDays === ''
    ? 30
    : Number(fields.expiryDays);
  if (!fields.grantorName || !String(fields.grantorName).trim())
    throw new Error('grantorName is required');
  if (!fields.agentLabel || !String(fields.agentLabel).trim())
    throw new Error('agentLabel is required');
  if (!(perTxCap > 0)) throw new Error('perTxCap must be a positive number');
  if (!(monthlyCap > 0)) throw new Error('monthlyCap must be a positive number');
  if (!Number.isFinite(expiryDays)) throw new Error('expiryDays must be a number');

  const now = Date.now();
  const id = 'm_' + crypto.randomBytes(6).toString('hex');
  const expiresAt = now + expiryDays * 24 * 60 * 60 * 1000;
  const categories = splitList(fields.categories);
  const payees = splitList(fields.payees);

  const payload = {
    mid: id,
    grantor: String(fields.grantorName).trim(),
    agent: String(fields.agentLabel).trim(),
    perTxCap,
    monthlyCap,
    categories,
    payees,
    iat: Math.floor(now / 1000),
    exp: Math.floor(expiresAt / 1000),
  };

  const mandate = {
    id,
    grantorName: payload.grantor,
    agentLabel: payload.agent,
    perTxCap,
    monthlyCap,
    categories,
    payees,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    status: 'active', // active | revoked
    token: signToken(payload),
  };
  db.mandates.push(mandate);
  return mandate;
}

function mandateStatus(mandate, now = Date.now()) {
  if (!mandate) return 'unknown';
  if (mandate.status === 'revoked') return 'revoked';
  if (now > new Date(mandate.expiresAt).getTime()) return 'expired';
  return 'active';
}

// Sum of this calendar month's completed payments for a mandate.
function spentThisMonth(db, mandateId, now = Date.now()) {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = d.getMonth();
  let sum = 0;
  for (const e of db.ledger) {
    if (e.mandateId !== mandateId) continue;
    if (e.decision !== 'allow') continue;
    if (!PAID_STATUSES.includes(e.paymentStatus)) continue;
    const t = new Date(e.ts);
    if (t.getFullYear() === y && t.getMonth() === m) sum += Number(e.amount) || 0;
  }
  return sum;
}

// The check. Pure: reads db, returns { allowed, reasons, mandateId }.
// Never writes anything; callers record the ledger entry.
function checkMandate(db, req, now = Date.now()) {
  const reasons = [];
  const amount = Number(req.amount);
  const category = req.category ? String(req.category).trim() : '';
  const payee = req.payee ? String(req.payee).trim() : '';

  const parsed = parseToken(req.token);
  if (parsed.error) return { allowed: false, reasons: [parsed.error], mandateId: null };
  const p = parsed.payload;

  const mandate = db.mandates.find((m) => m.id === p.mid);
  if (!mandate) return { allowed: false, reasons: ['Unknown mandate'], mandateId: p.mid || null };

  if (mandate.status === 'revoked') reasons.push('Mandate has been revoked');
  if (now > p.exp * 1000 || now > new Date(mandate.expiresAt).getTime())
    reasons.push('Mandate has expired');

  if (!(amount > 0)) {
    reasons.push('Amount must be a positive number');
  } else {
    if (amount > mandate.perTxCap)
      reasons.push(
        `Amount $${amount.toFixed(2)} exceeds the per-purchase cap of $${mandate.perTxCap.toFixed(2)}`
      );
    const spent = spentThisMonth(db, mandate.id, now);
    if (spent + amount > mandate.monthlyCap)
      reasons.push(
        `Monthly cap exceeded: $${spent.toFixed(2)} already spent this month + $${amount.toFixed(2)} is over the $${mandate.monthlyCap.toFixed(2)} monthly cap`
      );
  }

  if (mandate.categories.length > 0) {
    const ok = mandate.categories.some(
      (c) => c.toLowerCase() === category.toLowerCase()
    );
    if (!category || !ok)
      reasons.push(
        `Category "${category || '(none)'}" is not in the allowed categories (${mandate.categories.join(', ')})`
      );
  }

  if (mandate.payees.length > 0) {
    const ok = payee && mandate.payees.some((x) => x.toLowerCase() === payee.toLowerCase());
    if (!ok)
      reasons.push(
        `Payee "${payee || '(none)'}" is not on the payee allowlist (${mandate.payees.join(', ')})`
      );
  }

  return { allowed: reasons.length === 0, reasons, mandateId: mandate.id };
}

module.exports = {
  createMandate,
  checkMandate,
  parseToken,
  signToken,
  spentThisMonth,
  mandateStatus,
  PAID_STATUSES,
};
