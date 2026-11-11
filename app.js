'use strict';

const crypto = require('crypto');
const express = require('express');
const store = require('./lib/store');
const {
  createMandate,
  checkMandate,
  mandateStatus,
  spentThisMonth,
  PAID_STATUSES,
} = require('./lib/mandate');
const paypal = require('./lib/paypal');
const { CATALOG, runAgent } = require('./lib/agent');
const pages = require('./lib/pages');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const db = store.load();
const paypalMode = () => (paypal.configured() ? 'sandbox' : 'demo');

const inTour = (req) => req.query.tour === '1';

// ---------- Tour copy, per stop ----------
function tourFor(req, mandate) {
  if (!inTour(req)) return null;
  const step = req.query.step;
  if (req.path === '/grant')
    return {
      stepLabel: 'Step 1 of 5 · Grant',
      title: 'Guided tour',
      text: 'Set the lines for the office pass and press "Sign and grant this mandate". The defaults are the tour setup: $100 per purchase, $500 per month.',
    };
  if (req.path.startsWith('/mandate/') && step === '5')
    return {
      stepLabel: 'Step 5 of 5 · Revoke',
      title: 'Guided tour',
      text: 'Last step. Press "Revoke instantly" below. From that moment, every purchase attempted with this pass is refused, including by the agent.',
    };
  if (req.path.startsWith('/mandate/') && step === 'done')
    return {
      stepLabel: 'Tour complete',
      title: 'Guided tour',
      text: 'The pass is revoked. Run the agent once more if you like: every item is now refused with the reason "This pass has been revoked". That is the whole product: permission, checked before money moves, recorded, and revocable.',
      nextHref: '/ledger',
      nextLabel: 'See the full ledger',
    };
  if (req.path.startsWith('/mandate/'))
    return {
      stepLabel: 'Step 1 done',
      title: 'Guided tour',
      text: 'This is the signed pass the agent will carry. Note the token: change any character and the signature check fails. Next, send the agent shopping.',
      nextHref: '/agent?tour=1',
      nextLabel: 'Next: Steps 2 and 3, the agent',
    };
  if (req.path === '/agent')
    return {
      stepLabel: 'Steps 2 and 3 of 5 · The agent',
      title: 'Guided tour',
      text: 'First click "Restock office (inside limits)" and watch the agent buy. Then click "Buy a laptop (outside limits)" and watch the same pass refuse it before any money moves. Then continue to the ledger.',
      nextHref: '/ledger?tour=1',
      nextLabel: 'Next: Step 4, the ledger',
    };
  if (req.path === '/ledger') {
    const latest = db.mandates[db.mandates.length - 1];
    return {
      stepLabel: 'Step 4 of 5 · Ledger',
      title: 'Guided tour',
      text: 'Both runs are written here: the approved restock and the refused laptop, each with its reason in plain English. Final step: revoke the pass.',
      nextHref: latest ? `/mandate/${latest.id}?tour=1&step=5` : '/',
      nextLabel: 'Next: Step 5, revoke the pass',
    };
  }
  return null;
}

// ---------- Home ----------
app.get('/', (req, res) => {
  const now = Date.now();
  const counts = {
    mandates: db.mandates.length,
    active: db.mandates.filter((m) => mandateStatus(m, now) === 'active').length,
    checks: db.ledger.length,
    allowed: db.ledger.filter((e) => e.decision === 'allow').length,
    refused: db.ledger.filter((e) => e.decision === 'refuse').length,
    spent: db.ledger
      .filter((e) => PAID_STATUSES.includes(e.paymentStatus))
      .reduce((s, e) => s + (Number(e.amount) || 0), 0),
  };
  res.send(pages.homePage({ counts, paypalMode: paypalMode() }));
});

app.get('/tour', (req, res) => {
  res.send(pages.tourPage({ paypalMode: paypalMode() }));
});

// ---------- Mandates ----------
app.get('/grant', (req, res) => {
  res.send(pages.grantPage({ paypalMode: paypalMode(), tour: tourFor(req) }));
});

function doCreate(fields) {
  const mandate = createMandate(db, fields);
  store.save(db);
  return mandate;
}

app.post('/mandates', (req, res) => {
  try {
    const mandate = doCreate(req.body);
    const suffix = inTour(req) ? '?tour=1' : '';
    res.redirect(`/mandate/${mandate.id}${suffix}`);
  } catch (err) {
    res.status(400).send(pages.errorPage(err.message, paypalMode()));
  }
});

app.post('/api/mandates', (req, res) => {
  try {
    const mandate = doCreate(req.body || {});
    res.status(201).json({ mandate });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/mandate/:id', (req, res) => {
  const mandate = db.mandates.find((m) => m.id === req.params.id);
  if (!mandate) return res.status(404).send(pages.errorPage('Pass not found.', paypalMode()));
  res.send(
    pages.mandatePage({
      mandate,
      status: mandateStatus(mandate),
      spent: spentThisMonth(db, mandate.id),
      paypalMode: paypalMode(),
      tour: tourFor(req, mandate),
    })
  );
});

function doRevoke(id) {
  const mandate = db.mandates.find((m) => m.id === id);
  if (!mandate) return null;
  mandate.status = 'revoked';
  mandate.revokedAt = new Date().toISOString();
  store.save(db);
  return mandate;
}

app.post('/api/mandates/:id/revoke', (req, res) => {
  const mandate = doRevoke(req.params.id);
  if (!mandate) return res.status(404).json({ error: 'Pass not found' });
  res.json({ mandate, status: mandateStatus(mandate) });
});

app.post('/mandates/:id/revoke', (req, res) => {
  const mandate = doRevoke(req.params.id);
  if (!mandate) return res.status(404).send(pages.errorPage('Pass not found.', paypalMode()));
  const suffix = inTour(req) ? '?tour=1&step=done' : '';
  res.redirect(`/mandate/${mandate.id}${suffix}`);
});

// ---------- Verify ----------
app.post('/api/verify', (req, res) => {
  const { token, amount, category, payee, item } = req.body || {};
  const check = checkMandate(db, { token, amount, category, payee });
  const entry = {
    id: 'l_' + crypto.randomBytes(6).toString('hex'),
    ts: new Date().toISOString(),
    mandateId: check.mandateId,
    source: 'verify',
    item: item || '(API check)',
    amount: Number(amount) || 0,
    category: category || '',
    payee: payee || '',
    decision: check.allowed ? 'allow' : 'refuse',
    reasons: check.reasons,
    paymentStatus: check.allowed ? 'not_attempted' : 'refused',
    paypalOrderId: null,
    paymentDetail: check.allowed
      ? 'Check passed. No payment was made by /api/verify.'
      : null,
  };
  db.ledger.push(entry);
  store.save(db);
  res.json({ allowed: check.allowed, reasons: check.reasons, mandateId: check.mandateId });
});

// ---------- Agent ----------
app.get('/agent', (req, res) => {
  res.send(
    pages.agentPage({
      mandates: db.mandates,
      catalog: CATALOG,
      paypalMode: paypalMode(),
      tour: tourFor(req),
    })
  );
});

app.get('/api/catalog', (req, res) => res.json(CATALOG));

app.post('/api/agent/run', async (req, res) => {
  const { mandateId, instruction } = req.body || {};
  const mandate = db.mandates.find((m) => m.id === mandateId);
  if (!mandate) return res.status(404).json({ error: 'Pass not found' });
  if (!instruction || !String(instruction).trim())
    return res.status(400).json({ error: 'Give the agent an instruction first.' });
  try {
    const outcome = await runAgent(db, mandate, String(instruction));
    res.json(outcome);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ---------- Ledger ----------
app.get('/ledger', (req, res) => {
  res.send(
    pages.ledgerPage({ entries: db.ledger, paypalMode: paypalMode(), tour: tourFor(req) })
  );
});

app.get('/api/ledger', (req, res) => res.json(db.ledger));

module.exports = app;
