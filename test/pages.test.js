'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMandate, mandateStatus } = require('../lib/mandate');
const pages = require('../lib/pages');

function makePass() {
  const db = { mandates: [], ledger: [] };
  return createMandate(db, {
    grantorName: 'Jordan Rivera',
    agentLabel: 'OfficeBot',
    perTxCap: 100,
    monthlyCap: 500,
    categories: 'Office supplies, Electronics',
    payees: '',
    expiryDays: 30,
  });
}

test('pass detail page renders the designed pass card at the top', () => {
  const m = makePass();
  const html = pages.mandatePage({
    mandate: m,
    status: mandateStatus(m),
    spent: 0,
    paypalMode: 'demo',
    tour: null,
  });

  // The card exists and carries the brand.
  assert.match(html, /class="passcard"/);
  assert.match(html, /passcard-brand">AUTHPAL</);

  // Card appears before the details card.
  assert.ok(html.indexOf('passcard') < html.indexOf('Signed pass token'));

  // Grantor, agent, caps, categories and status pill are on the card.
  assert.match(html, /Jordan Rivera/);
  assert.match(html, /OfficeBot/);
  assert.match(html, /\$100\.00/);
  assert.match(html, /\$500\.00/);
  assert.match(html, /Office supplies, Electronics/);
  assert.match(html, /pill active">ACTIVE</);

  // Signature fingerprint: first 16 characters of the token signature segment.
  // (Scoped to the card: the full token also appears in the token box below it.)
  const sig = m.token.split('.')[1];
  const card = html.slice(html.indexOf('class="passcard"'), html.indexOf('<div class="card">'));
  assert.ok(card.includes(sig.slice(0, 16)));
  assert.ok(!card.includes(sig.slice(0, 24)), 'card shows only the short fingerprint');

  // The existing details, token and revoke elements are still present below.
  assert.match(html, /Signed pass token/);
  assert.match(html, /Revoke instantly/);
});

test('pages ship the small-screen responsive rules', () => {
  const html = pages.homePage({
    counts: { mandates: 0, active: 0, checks: 0, allowed: 0, refused: 0, spent: 0 },
    paypalMode: 'demo',
  });
  assert.match(html, /@media \(max-width: 640px\)/);
  // Nav wraps full width, detail grid stacks, tables scroll in their own box.
  assert.match(html, /nav \{ order: 3; width: 100%;/);
  assert.match(html, /\.kv \{ grid-template-columns: 1fr;/);
  assert.match(html, /table \{ display: block; overflow-x: auto;/);
});
