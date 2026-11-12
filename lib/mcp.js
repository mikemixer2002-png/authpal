'use strict';

// Model Context Protocol (MCP) endpoint: JSON-RPC 2.0 over HTTP, stateless.
// The same pass rules apply here as everywhere else in AuthPal. These tools
// are another door into the same checks, not a way around them.
//
// Tools:
//   grant_pass      Create a pass (same inputs as POST /api/mandates).
//   check_purchase  Run the permission check and record it. Never pays.
//   pay_with_pass   Run the check; when allowed, pay through PayPal.
//   revoke_pass     Revoke a pass immediately.

const crypto = require('crypto');
const { createMandate, checkMandate, mandateStatus } = require('./mandate');
const paypal = require('./paypal');
const store = require('./store');

const SERVER_INFO = { name: 'authpal', version: '1.0.0' };
const DEFAULT_PROTOCOL_VERSION = '2024-11-05';

const PURCHASE_SCHEMA = {
  type: 'object',
  properties: {
    token: { type: 'string', description: 'The signed pass token (or give mandateId instead)' },
    mandateId: { type: 'string', description: 'The pass id (or give token instead)' },
    amount: { type: 'number', description: 'Purchase amount in USD' },
    category: { type: 'string', description: 'Purchase category' },
    payee: { type: 'string', description: 'Seller name' },
    item: { type: 'string', description: 'What is being bought' },
  },
  required: ['amount'],
};

const TOOLS = [
  {
    name: 'grant_pass',
    description:
      'Grant a new AuthPal pass: a signed, limited permission for an AI agent to spend. Returns the pass, including its signed token.',
    inputSchema: {
      type: 'object',
      properties: {
        grantorName: { type: 'string', description: 'Name of the person granting the pass' },
        agentLabel: { type: 'string', description: 'Label for the agent that will carry the pass' },
        perTxCap: { type: 'number', description: 'Maximum amount per purchase, in USD' },
        monthlyCap: { type: 'number', description: 'Maximum total spend per month, in USD' },
        categories: { type: 'string', description: 'Allowed categories, comma separated; blank means any' },
        payees: { type: 'string', description: 'Seller allowlist, comma separated; blank means any seller' },
        expiryDays: { type: 'number', description: 'Days until the pass expires (default 30)' },
        maxUses: { type: 'number', description: 'Optional maximum purchases per month; 1 means a single-use pass' },
      },
      required: ['grantorName', 'agentLabel', 'perTxCap', 'monthlyCap'],
    },
  },
  {
    name: 'check_purchase',
    description:
      'Check a proposed purchase against a pass and record the check in the ledger. Never moves money.',
    inputSchema: PURCHASE_SCHEMA,
  },
  {
    name: 'pay_with_pass',
    description:
      'Check a purchase against a pass and, when the pass allows it, pay through PayPal (sandbox). Refused purchases never reach PayPal.',
    inputSchema: PURCHASE_SCHEMA,
  },
  {
    name: 'revoke_pass',
    description:
      'Revoke a pass immediately. Every later purchase attempted with it is refused.',
    inputSchema: {
      type: 'object',
      properties: {
        mandateId: { type: 'string', description: 'The pass id to revoke' },
      },
      required: ['mandateId'],
    },
  },
];

function textResult(obj, isError = false) {
  const result = { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] };
  if (isError) result.isError = true;
  return result;
}

function resolveToken(db, args) {
  if (args.token) return { token: String(args.token) };
  if (args.mandateId) {
    const found = db.mandates.find((m) => m.id === args.mandateId);
    if (!found) return { error: 'Pass not found' };
    return { token: found.token };
  }
  return { error: 'Provide a pass token or a mandateId' };
}

function ledgerEntry(fields) {
  return {
    id: 'l_' + crypto.randomBytes(6).toString('hex'),
    ts: new Date().toISOString(),
    source: 'mcp',
    paymentStatus: 'refused',
    paypalOrderId: null,
    paymentDetail: null,
    approveUrl: null,
    ...fields,
  };
}

// Returns a tool result, or null when the tool name is unknown.
async function callTool(ctx, name, args) {
  const db = ctx.db;
  switch (name) {
    case 'grant_pass': {
      try {
        const mandate = createMandate(db, args || {});
        store.save(db);
        return textResult({ mandate });
      } catch (err) {
        return textResult({ error: err.message }, true);
      }
    }
    case 'check_purchase': {
      const resolved = resolveToken(db, args || {});
      if (resolved.error) return textResult({ error: resolved.error }, true);
      const check = checkMandate(db, {
        token: resolved.token,
        amount: args.amount,
        category: args.category,
        payee: args.payee,
      });
      db.ledger.push(
        ledgerEntry({
          mandateId: check.mandateId,
          item: args.item || '(MCP check)',
          amount: Number(args.amount) || 0,
          category: args.category || '',
          payee: args.payee || '',
          decision: check.allowed ? 'allow' : 'refuse',
          reasons: check.reasons,
          paymentStatus: check.allowed ? 'not_attempted' : 'refused',
          paymentDetail: check.allowed
            ? 'Check passed. No payment was made by check_purchase.'
            : null,
        })
      );
      store.save(db);
      return textResult({
        allowed: check.allowed,
        reasons: check.reasons,
        mandateId: check.mandateId,
      });
    }
    case 'pay_with_pass': {
      const resolved = resolveToken(db, args || {});
      if (resolved.error) return textResult({ error: resolved.error }, true);
      const check = checkMandate(db, {
        token: resolved.token,
        amount: args.amount,
        category: args.category,
        payee: args.payee,
      });
      const entry = ledgerEntry({
        mandateId: check.mandateId,
        item: args.item || '(MCP purchase)',
        amount: Number(args.amount) || 0,
        category: args.category || '',
        payee: args.payee || '',
        decision: check.allowed ? 'allow' : 'refuse',
        reasons: check.reasons,
      });
      if (!check.allowed) {
        db.ledger.push(entry);
        store.save(db);
        return textResult({
          allowed: false,
          reasons: check.reasons,
          mandateId: check.mandateId,
        });
      }
      try {
        const payment = await paypal.pay({
          amount: Number(args.amount),
          description: `${entry.item} via AuthPal (MCP)`,
        });
        entry.paymentStatus = payment.status; // captured | order_created | demo
        entry.paypalOrderId = payment.orderId;
        entry.paymentDetail = payment.detail;
        entry.approveUrl = payment.approveUrl || null;
        db.ledger.push(entry);
        store.save(db);
        return textResult({
          allowed: true,
          mandateId: check.mandateId,
          payment: {
            status: payment.status,
            orderId: payment.orderId,
            detail: payment.detail,
            approveUrl: payment.approveUrl || null,
          },
        });
      } catch (err) {
        entry.paymentStatus = 'payment_error';
        entry.paymentDetail = String(err.message || err);
        db.ledger.push(entry);
        store.save(db);
        return textResult(
          {
            allowed: true,
            mandateId: check.mandateId,
            payment: { status: 'payment_error', detail: entry.paymentDetail },
          },
          true
        );
      }
    }
    case 'revoke_pass': {
      const mandate = ctx.revoke(args && args.mandateId);
      if (!mandate) return textResult({ error: 'Pass not found' }, true);
      return textResult({ mandate, status: mandateStatus(mandate) });
    }
    default:
      return null;
  }
}

async function handleOne(ctx, msg) {
  const isNotification = !msg || msg.id === undefined;
  const respond = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
  const fail = (code, message) => ({
    jsonrpc: '2.0',
    id: msg && msg.id !== undefined ? msg.id : null,
    error: { code, message },
  });

  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return isNotification ? null : fail(-32600, 'Invalid request');
  }

  try {
    switch (msg.method) {
      case 'initialize':
        return respond({
          protocolVersion:
            (msg.params && msg.params.protocolVersion) || DEFAULT_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });
      case 'ping':
        return respond({});
      case 'tools/list':
        return respond({ tools: TOOLS });
      case 'tools/call': {
        const params = msg.params || {};
        const result = await callTool(ctx, params.name, params.arguments || {});
        if (result === null) return fail(-32602, `Unknown tool: ${params.name}`);
        return respond(result);
      }
      default:
        return isNotification ? null : fail(-32601, `Method not found: ${msg.method}`);
    }
  } catch (err) {
    return isNotification ? null : fail(-32603, String(err.message || err));
  }
}

// Handles one JSON-RPC message or a batch. Resolves to the response
// object (or array), or null when there is nothing to send back
// (notifications only), in which case the route answers 202.
async function handleMcp(ctx, body) {
  if (Array.isArray(body)) {
    const out = [];
    for (const msg of body) {
      const response = await handleOne(ctx, msg);
      if (response) out.push(response);
    }
    return out.length ? out : null;
  }
  return handleOne(ctx, body);
}

module.exports = { handleMcp, TOOLS, SERVER_INFO };
