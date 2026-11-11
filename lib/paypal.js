'use strict';

// PayPal Orders API v2 (sandbox). Server-side only; credentials come from
// PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET and are never hardcoded.
//
// Flow: OAuth client-credentials token -> create order (intent CAPTURE) ->
// try to capture immediately. A freshly created order normally needs buyer
// approval before capture, so when capture is refused we fall back to the
// created order itself as the payment proof (status "order_created"),
// which is what the demo needs.
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

// Returns { mode: 'paypal'|'demo', status: 'captured'|'order_created'|'demo',
//           orderId: string|null, detail: string }
async function pay({ amount, description }) {
  if (!configured()) {
    return {
      mode: 'demo',
      status: 'demo',
      orderId: null,
      detail: 'DEMO MODE (no PayPal credentials): payment simulated',
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
    detail: 'PayPal sandbox order created (capture needs buyer approval; order stands as payment proof)',
  };
}

module.exports = { configured, pay };
