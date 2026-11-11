'use strict';

// Server-rendered pages. One layout, inline CSS, no frameworks, no build step.
// Dark slate + gold accent fintech look. Product name: AuthPal.
// Tagline: "The permission slip for AI money."

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(n) {
  return '$' + Number(n || 0).toFixed(2);
}

function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso || '');
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const CSS = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         background:#0b1220; color:#e6ebf2; }
  header { border-bottom:1px solid #1e2c47; background:#0e1830; }
  .wrap { max-width: 920px; margin: 0 auto; padding: 20px 18px 48px; }
  header .wrap { padding-top:14px; padding-bottom:14px; display:flex; align-items:center; gap:18px; flex-wrap:wrap; }
  .brand { font-size: 22px; font-weight: 800; letter-spacing: .4px; color:#f2c14e; text-decoration:none; }
  .brand small { display:block; font-size:11px; font-weight:600; color:#93a5c4; letter-spacing:.8px; text-transform:uppercase; }
  nav a { color:#c8d4ea; text-decoration:none; margin-right:14px; font-size:14px; }
  nav a:hover { color:#f2c14e; }
  .modepill { margin-left:auto; font-size:12px; font-weight:700; padding:5px 12px; border-radius:999px; }
  .modepill.sandbox { background:#1d4d2b; color:#8be89b; }
  .modepill.demo { background:#3a2f10; color:#ffe9a8; border:1px solid #f2c14e; }
  h1 { font-size:28px; margin: 22px 0 8px; line-height:1.25; }
  h2 { font-size:19px; margin: 24px 0 8px; color:#f2c14e; }
  p, li { line-height:1.55; color:#c8d4ea; }
  .card { background:#111c30; border:1px solid #22345a; border-radius:12px; padding:18px; margin:14px 0; }
  .gold { color:#f2c14e; }
  .muted { color:#93a5c4; font-size:13px; }
  .grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(150px,1fr)); gap:12px; }
  .stat { background:#0e1830; border:1px solid #22345a; border-radius:10px; padding:12px; }
  .stat b { display:block; font-size:24px; color:#f2c14e; }
  .stat span { font-size:12px; color:#93a5c4; text-transform:uppercase; letter-spacing:.6px; }
  label { display:block; font-size:13px; color:#93a5c4; margin:12px 0 4px; }
  input, select, textarea { width:100%; padding:10px; border-radius:8px; border:1px solid #2b4066;
    background:#0b1220; color:#e6ebf2; font-size:15px; }
  textarea { font-family: ui-monospace, Menlo, Consolas, monospace; font-size:12px; word-break: break-all; }
  button, .btn { display:inline-block; background:#f2c14e; color:#14100a; border:0; border-radius:8px;
    padding:11px 18px; font-size:15px; font-weight:700; cursor:pointer; text-decoration:none; margin:6px 6px 6px 0; }
  button:hover, .btn:hover { background:#ffd873; }
  button.secondary, .btn.secondary { background:#22345a; color:#e6ebf2; }
  button.danger { background:#b3382e; color:#fff; }
  .pill { display:inline-block; padding:2px 10px; border-radius:999px; font-size:12px; font-weight:700; }
  .pill.active { background:#1d4d2b; color:#8be89b; }
  .pill.revoked, .pill.expired { background:#5a1f1a; color:#ff9d94; }
  .pill.allow { background:#1d4d2b; color:#8be89b; }
  .pill.refuse { background:#5a1f1a; color:#ff9d94; }
  table { width:100%; border-collapse: collapse; font-size:13.5px; }
  th, td { text-align:left; padding:8px 7px; border-bottom:1px solid #22345a; vertical-align: top; }
  th { color:#93a5c4; text-transform:uppercase; font-size:11px; letter-spacing:.6px; }
  .banner { border-radius:10px; padding:12px 14px; margin:14px 0; font-size:14px; }
  .banner.demo { background:#3a2f10; border:1px solid #f2c14e; color:#ffe9a8; }
  .banner.err { background:#5a1f1a; border:1px solid #b3382e; color:#ffd7d3; }
  .tourbar { background:#16263f; border:1px solid #f2c14e; border-radius:12px; padding:14px 16px; margin:16px 0; }
  .tourbar .step { display:inline-block; background:#f2c14e; color:#14100a; font-weight:800; font-size:12px;
    padding:3px 10px; border-radius:999px; margin-right:8px; text-transform:uppercase; letter-spacing:.5px; }
  .tourbar p { margin:6px 0 4px; }
  #report li { margin: 5px 0; }
  .kv { display:grid; grid-template-columns: 190px 1fr; gap:6px 14px; font-size:15px; }
  .kv dt { color:#93a5c4; } .kv dd { margin:0; }
  .steps { counter-reset: step; padding-left: 0; list-style: none; }
  .steps li { margin: 10px 0; padding-left: 8px; }
  footer { border-top:1px solid #1e2c47; color:#66788f; font-size:12px; }
`;

// opts: { paypalMode: 'sandbox'|'demo', tour: {stepLabel, text, nextHref, nextLabel} | null }
function layout(title, body, opts = {}) {
  const mode = opts.paypalMode === 'sandbox' ? 'sandbox' : 'demo';
  const tour = opts.tour
    ? `<div class="tourbar"><span class="step">${esc(opts.tour.stepLabel)}</span>
         <strong>${esc(opts.tour.title || 'Guided tour')}</strong>
         <p>${esc(opts.tour.text)}</p>
         ${opts.tour.nextHref ? `<a class="btn" href="${esc(opts.tour.nextHref)}">${esc(opts.tour.nextLabel || 'Next step')}</a>` : ''}
         <a class="btn secondary" href="/">Exit tour</a></div>`
    : '';
  const demoBanner =
    mode === 'demo'
      ? '<div class="banner demo"><strong>PayPal: Demo mode.</strong> No PayPal credentials are set on this server, so the payment step is simulated and ledger entries say DEMO MODE. Everything else (the permission check, the refusals, the ledger) is fully real. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to run payments against the PayPal sandbox.</div>'
      : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · AuthPal</title>
<style>${CSS}</style>
</head>
<body>
<header><div class="wrap">
  <a class="brand" href="/">AUTHPAL<small>The permission slip for AI money</small></a>
  <nav>
    <a href="/tour">2-minute tour</a>
    <a href="/grant">Grant</a>
    <a href="/agent">Agent</a>
    <a href="/ledger">Ledger</a>
  </nav>
  <span class="modepill ${mode}">${mode === 'sandbox' ? 'PayPal: Sandbox connected' : 'PayPal: Demo mode'}</span>
</div></header>
<main class="wrap">
${tour}
${demoBanner}
${body}
</main>
<footer><div class="wrap">AuthPal. Denied purchases are refused before any money moves; they never reach PayPal.</div></footer>
</body>
</html>`;
}

function homePage({ counts, paypalMode }) {
  const body = `
  <h1>Your AI agent is about to spend your money.<br><span class="gold">What did you actually allow?</span></h1>
  <p>AI agents have started buying things for us: restocking the office, booking
  travel, paying for software. But payments were built for a person pressing a
  button. When software spends, there is no standard way to prove what the person
  allowed: how much, for what, from whom, and until when. So every business faces
  the same bad choice: give the agent a card with no limits, or do not let it
  spend at all.</p>
  <p><strong class="gold">AuthPal is the permission slip for AI money.</strong> You grant an agent a
  signed, limited pass: a cap on each purchase, a cap per month, the categories it
  may buy, an optional list of approved sellers, and an expiry date. Every payment
  is checked against the pass <em>before</em> money moves. Inside the lines, it pays
  through PayPal. Outside the lines, it is refused on the spot, and the refusal is
  written down with its reason in plain English. Every decision lands in a ledger
  you can read, and you can tear the pass up instantly.</p>

  <div class="card">
    <h2 style="margin-top:0">See the whole product in 2 minutes</h2>
    <p>The guided tour walks the full story in order: grant a pass, watch the agent
    buy inside the limits, watch it get refused outside them, read the ledger, then
    revoke the pass and see the next purchase fail.</p>
    <a class="btn" href="/grant?tour=1">Start the 2-minute tour</a>
    <a class="btn secondary" href="/tour">How the tour works</a>
  </div>

  <div class="grid">
    <div class="stat"><b>${counts.mandates}</b><span>Passes granted</span></div>
    <div class="stat"><b>${counts.active}</b><span>Active now</span></div>
    <div class="stat"><b>${counts.checks}</b><span>Checks in ledger</span></div>
    <div class="stat"><b>${counts.allowed}</b><span>Allowed</span></div>
    <div class="stat"><b>${counts.refused}</b><span>Refused</span></div>
    <div class="stat"><b>${money(counts.spent)}</b><span>Spent under passes</span></div>
  </div>

  <div class="card">
    <h2 style="margin-top:0">How it works</h2>
    <ol class="steps">
      <li><strong class="gold">1. Grant.</strong> Set the limits once: per purchase, per month, categories, sellers, expiry. The pass is signed, so nobody can quietly widen it.</li>
      <li><strong class="gold">2. Check.</strong> Before any payment, the agent's request is compared with the pass, including what it already spent this month.</li>
      <li><strong class="gold">3. Pay or refuse.</strong> Inside the lines, the payment runs through PayPal. Outside them, it is refused before a cent moves, never after.</li>
      <li><strong class="gold">4. Record.</strong> Every check, allowed or refused, is written to the ledger with its reason. A dispute gets settled by reading, not arguing.</li>
      <li><strong class="gold">5. Revoke.</strong> One click ends the pass. Every later purchase is refused.</li>
    </ol>
    <a class="btn" href="/grant">Grant a pass</a>
    <a class="btn secondary" href="/agent">Open the agent</a>
    <a class="btn secondary" href="/ledger">Read the ledger</a>
  </div>`;
  return layout('Home', body, { paypalMode });
}

function tourPage({ paypalMode }) {
  const body = `
  <h1>The 2-minute tour</h1>
  <p>Five steps, in order. You will play both sides: the person who sets the
  limits, and the agent who has to live inside them.</p>
  <div class="card">
    <ol class="steps">
      <li><strong class="gold">Step 1 · Grant.</strong> Create a pass for a small office: $100 per purchase, $500 per month, office categories. Takes about 20 seconds.</li>
      <li><strong class="gold">Step 2 · Agent buys inside the limits.</strong> One click runs the weekly office restock: paper, coffee pods, notebooks, markers. Everything is approved and paid.</li>
      <li><strong class="gold">Step 3 · Agent gets refused.</strong> The agent tries to buy a $1,299 laptop on the same pass. The per-purchase cap stops it before any money moves.</li>
      <li><strong class="gold">Step 4 · Ledger.</strong> Read the record: both runs, every item, every reason, in plain English.</li>
      <li><strong class="gold">Step 5 · Revoke.</strong> Tear up the pass, then watch any later purchase get refused instantly.</li>
    </ol>
    <a class="btn" href="/grant?tour=1">Begin step 1: Grant</a>
  </div>`;
  return layout('The 2-minute tour', body, { paypalMode });
}

function grantPage({ paypalMode, tour }) {
  const action = tour ? '/mandates?tour=1' : '/mandates';
  const body = `
  <h1>Grant a pass</h1>
  <p>You are the office manager of a small business, handing your AI agent the
  weekly shopping. Set the lines once: the agent may spend inside them without
  asking again, and cannot spend outside them at all. The defaults below are the
  tour's office pass; change anything you like.</p>
  <form class="card" method="POST" action="${action}">
    <label for="grantorName">Your name (the grantor)</label>
    <input id="grantorName" name="grantorName" required value="Jordan Rivera">
    <label for="agentLabel">Agent label</label>
    <input id="agentLabel" name="agentLabel" required value="OfficeBot">
    <label for="perTxCap">Per-purchase cap (USD)</label>
    <input id="perTxCap" name="perTxCap" type="number" step="0.01" min="0.01" required value="100">
    <label for="monthlyCap">Monthly cap (USD)</label>
    <input id="monthlyCap" name="monthlyCap" type="number" step="0.01" min="0.01" required value="500">
    <label for="categories">Allowed categories (comma separated)</label>
    <input id="categories" name="categories" value="Office supplies, Electronics, Groceries">
    <label for="payees">Payee allowlist (comma separated, optional; blank means any seller)</label>
    <input id="payees" name="payees" placeholder="OfficeMart, TechSupply Co">
    <label for="expiryDays">Expires in (days)</label>
    <input id="expiryDays" name="expiryDays" type="number" step="1" required value="30">
    <button type="submit">Sign and grant this pass</button>
  </form>`;
  return layout('Grant a pass', body, { paypalMode, tour });
}

function mandatePage({ mandate, status, spent, paypalMode, tour }) {
  const revokeAction = tour
    ? `/mandates/${esc(mandate.id)}/revoke?tour=1`
    : `/mandates/${esc(mandate.id)}/revoke`;
  const body = `
  <h1>Your pass</h1>
  <div class="card">
    <p>Status: <span class="pill ${esc(status)}">${esc(status.toUpperCase())}</span></p>
    <dl class="kv">
      <dt>Grantor</dt><dd>${esc(mandate.grantorName)}</dd>
      <dt>Agent</dt><dd>${esc(mandate.agentLabel)}</dd>
      <dt>Per-purchase cap</dt><dd>${money(mandate.perTxCap)}</dd>
      <dt>Monthly cap</dt><dd>${money(mandate.monthlyCap)} &nbsp;<span class="muted">(${money(spent)} spent this month)</span></dd>
      <dt>Allowed categories</dt><dd>${mandate.categories.length ? esc(mandate.categories.join(', ')) : 'Any'}</dd>
      <dt>Payee allowlist</dt><dd>${mandate.payees.length ? esc(mandate.payees.join(', ')) : 'Any seller'}</dd>
      <dt>Granted</dt><dd>${fmtDate(mandate.createdAt)}</dd>
      <dt>Expires</dt><dd>${fmtDate(mandate.expiresAt)}</dd>
      <dt>Pass ID</dt><dd><code>${esc(mandate.id)}</code></dd>
    </dl>
    <label for="token">Signed pass token (the agent carries this; change one character and the signature breaks)</label>
    <textarea id="token" rows="4" readonly>${esc(mandate.token)}</textarea>
    ${
      status === 'active'
        ? `<form method="POST" action="${revokeAction}" onsubmit="return confirm('Revoke this mandate? Every later purchase will be refused.')">
             <button class="danger" type="submit">Revoke instantly</button>
           </form>`
        : '<p class="muted">This pass can no longer be used. Any purchase attempted with it is refused.</p>'
    }
    <p><a class="btn secondary" href="/agent${tour ? '?tour=1' : ''}">Send the agent shopping</a>
       <a class="btn secondary" href="/ledger${tour ? '?tour=1' : ''}">View the ledger</a></p>
  </div>`;
  return layout('Your pass', body, { paypalMode, tour });
}

function agentPage({ mandates, catalog, paypalMode, tour }) {
  const options = mandates
    .map(
      (m) =>
        `<option value="${esc(m.id)}">${esc(m.grantorName)} → ${esc(m.agentLabel)} (cap ${money(m.perTxCap)}/purchase, ${money(m.monthlyCap)}/month)</option>`
    )
    .join('');
  const catalogRows = catalog
    .map(
      (i) =>
        `<tr><td>${esc(i.name)}</td><td>${money(i.price)}</td><td>${esc(i.category)}</td><td>${esc(i.payee)}</td></tr>`
    )
    .join('');
  const body = `
  <h1>The office agent</h1>
  <p>The scenario: <strong>OfficeBot</strong> runs the shopping for a small office. Pick its
  mandate, give it an instruction in plain words, and watch the pass decide.
  Approved items are paid through PayPal${paypalMode === 'sandbox' ? ' sandbox' : ' (simulated in demo mode)'}.
  Refused items never reach PayPal. Try both presets: the restock fits the pass,
  the laptop does not.</p>
  ${
    mandates.length === 0
      ? '<div class="banner err">No passes yet. <a class="gold" href="/grant">Grant one first</a> and the agent will have a pass to carry.</div>'
      : `<div class="card">
    <label for="mandateId">Pass the agent carries</label>
    <select id="mandateId">${options}</select>
    <label for="instruction">Instruction</label>
    <input id="instruction" value="Buy printer paper and coffee pods for the office">
    <div>
      <button id="runBtn" type="button">Run the agent</button>
      <button class="secondary" id="presetOk" type="button">Preset: Restock office (inside limits)</button>
      <button class="secondary" id="presetBig" type="button">Preset: Buy a laptop (outside limits)</button>
    </div>
    <h2>Run report</h2>
    <ul id="report"><li class="muted">No run yet. Pick a preset above and watch the decisions happen.</li></ul>
  </div>
  <div class="card">
    <h2 style="margin-top:0">Demo catalog</h2>
    <p class="muted">The agent can only buy from this fixed catalog, so every run is repeatable.
    Your own words work too: try paper, coffee, mouse, pizza, flight, antivirus.</p>
    <table><tr><th>Item</th><th>Price</th><th>Category</th><th>Seller</th></tr>${catalogRows}</table>
  </div>
  <script>
    const reportEl = document.getElementById('report');
    function escHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;'); }
    async function runAgent(instruction) {
      const mandateId = document.getElementById('mandateId').value;
      reportEl.innerHTML = '<li>Running… the agent is checking each item against the mandate.</li>';
      try {
        const res = await fetch('/api/agent/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mandateId, instruction })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Run failed');
        reportEl.innerHTML = data.report.map(l => '<li>' + escHtml(l) + '</li>').join('')
          || '<li>Nothing happened.</li>';
      } catch (e) {
        reportEl.innerHTML = '<li>Error: ' + escHtml(e.message) + '</li>';
      }
    }
    document.getElementById('runBtn').addEventListener('click', () =>
      runAgent(document.getElementById('instruction').value));
    document.getElementById('presetOk').addEventListener('click', () => {
      const v = 'Restock the office: buy printer paper, coffee pods, notebooks and whiteboard markers';
      document.getElementById('instruction').value = v; runAgent(v);
    });
    document.getElementById('presetBig').addEventListener('click', () => {
      const v = 'Buy a laptop for the new hire';
      document.getElementById('instruction').value = v; runAgent(v);
    });
  </script>`
  }`;
  return layout('Agent', body, { paypalMode, tour });
}

function ledgerPage({ entries, paypalMode, tour }) {
  const rows = entries
    .slice()
    .reverse()
    .map((e) => {
      const statusLabel =
        e.paymentStatus === 'demo' ? 'DEMO MODE (no PayPal credentials)' : e.paymentStatus;
      return `<tr>
        <td>${esc(fmtDate(e.ts))}</td>
        <td><code>${esc(e.mandateId || '(none)')}</code></td>
        <td>${esc(e.item || '')}<br><span class="muted">${esc(e.category || '')} · ${esc(e.payee || '')} · via ${esc(e.source || '')}</span></td>
        <td>${money(e.amount)}</td>
        <td><span class="pill ${e.decision === 'allow' ? 'allow' : 'refuse'}">${esc(e.decision.toUpperCase())}</span></td>
        <td>${esc(statusLabel)}${e.paypalOrderId ? `<br><span class="muted">Order ${esc(e.paypalOrderId)}</span>` : ''}</td>
        <td>${esc((e.reasons || []).join(' ') || (e.paymentDetail || ''))}</td>
      </tr>`;
    })
    .join('');
  const body = `
  <h1>Ledger</h1>
  <p>Every check and every payment, newest first. This is the record a dispute gets
  settled from: what was allowed, what was refused, and exactly why, in plain English.</p>
  <div class="card" style="overflow-x:auto">
  ${
    entries.length === 0
      ? '<p class="muted">Nothing here yet. Once the agent runs, every decision it makes will be written on this page.</p>'
      : `<table>
    <tr><th>Time</th><th>Pass</th><th>Item</th><th>Amount</th><th>Decision</th><th>Payment</th><th>Reason / detail</th></tr>
    ${rows}
  </table>`
  }
  </div>`;
  return layout('Ledger', body, { paypalMode, tour });
}

function errorPage(message, paypalMode) {
  return layout(
    'Something went wrong',
    `<h1>Something went wrong</h1><div class="banner err">${esc(message)}</div><p><a class="btn secondary" href="/">Back home</a></p>`,
    { paypalMode }
  );
}

module.exports = {
  esc,
  money,
  fmtDate,
  homePage,
  tourPage,
  grantPage,
  mandatePage,
  agentPage,
  ledgerPage,
  errorPage,
};
