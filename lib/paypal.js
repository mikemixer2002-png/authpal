'use strict';

// PayPal Orders API v2 (sandbox). Server-side only; credentials come from
// PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET and are never hardcoded.
//
// Flow: OAuth client-credentials token -> create order (intent CAPTURE) ->
// try to capture immediately. A freshly created order normally needs buyer
// approval first, so the order's approval link travels with the result:
// the buyer can approve in PayPal and the order can then be captured with
// captureOrder(). Until then the created order itself stands as the
// payment proof (status "order_created").
//
// If the env vars are not set, pay() runs in DEMO MODE: it simulates the
// PayPal step and the ledger entry is labeled "demo".

const API_BASE = 'https://api-m.sandbox.paypal.com';

function configured() {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

async function getAccessToken() {
  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString('base64');
  const res = await fetch(`${API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`PayPal OAuth failed: HTTP ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

function approveLink(order) {
  const links = (order && order.links) || [];
  const found =
    links.find((l) => l.rel === 'payer-action') ||
    links.find((l) => l.rel === 'approve');
  return found ? found.href : null;
}

// Returns { mode: 'paypal'|'demo', status: 'captured'|'order_created'|'demo',
//           orderId: string|null, detail: string, approveUrl: string|null }
async function pay({ amount, description }) {
  if (!configured()) {
    return {
      mode: 'demo',
      status: 'demo',
      orderId: null,
      detail: 'DEMO MODE (no PayPal credentials): payment simulated',
      approveUrl: null,
    };
  }

  const accessToken = await getAccessToken();
  const createRes = await fetch(`${API_BASE}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          description: String(description || 'AuthPal agent purchase').slice(0, 127),
          amount: { currency_code: 'USD', value: Number(amount).toFixed(2) },
        },
      ],
    }),
  });
  if (!createRes.ok)
    throw new Error(`PayPal create order failed: HTTP ${createRes.status}`);
  const order = await createRes.json();

  // Best effort: capture right away. Without buyer approval PayPal refuses
  // the capture; the created order then stands as the demo payment proof.
  try {
    const capRes = await fetch(`${API_BASE}/v2/checkout/orders/${order.id}/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
    if (capRes.ok) {
      const captured = await capRes.json();
      if (captured.status === 'COMPLETED') {
        return {
          mode: 'paypal',
          status: 'captured',
          orderId: order.id,
          detail: 'PayPal sandbox order captured',
          approveUrl: null,
        };
      }
    }
  } catch {
    // fall through to order_created
  }
  return {
    mode: 'paypal',
    status: 'order_created',
    orderId: order.id,
    detail: 'PayPal sandbox order created (approve in PayPal, then capture to complete the payment)',
    approveUrl: approveLink(order),
  };
}

// Capture a previously created order, once the buyer has approved it.
// Never throws: every outcome comes back as a result object, so callers
// can show the reason instead of crashing.
// Returns { ok: true, status: 'captured', detail } or { ok: false, error }.
async function captureOrder(orderId) {
  if (!configured()) {
    return {
      ok: false,
      error:
        'PayPal is not configured on this server (demo mode), so there is no order to capture.',
    };
  }
  let accessToken;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
  let res;
  try {
    res = await fetch(`${API_BASE}/v2/checkout/orders/${orderId}/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
  } catch (err) {
    return { ok: false, error: `PayPal capture request failed: ${String(err.message || err)}` };
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    // An empty or unreadable body still leaves the HTTP status to report.
  }
  if (res.ok && data.status === 'COMPLETED') {
    return { ok: true, status: 'captured', detail: 'PayPal sandbox order captured' };
  }
  const first = (data.details && data.details[0]) || {};
  if (first.issue === 'ORDER_NOT_APPROVED') {
    return {
      ok: false,
      error:
        'PayPal refused the capture: the buyer has not approved this order yet. Open the approval link first, then capture.',
    };
  }
  const why = first.description || data.message || `HTTP ${res.status}`;
  return { ok: false, error: `PayPal refused the capture: ${why}` };
}

module.exports = { configured, pay, captureOrder };
