# Mandate

**The permission slip for AI money.**

AI agents have started spending money on our behalf: restocking offices, booking
travel, paying for software. Payments were built for a person pressing a button,
so there is no standard way to prove what the person actually allowed an agent
to spend: how much, for what, from whom, and until when.

Mandate fixes that. A person grants an agent a **signed, limited permission**
(a mandate): a cap per purchase, a cap per month, allowed categories, an
optional payee allowlist, and an expiry date. Before any agent purchase, the
payment is checked against the mandate. Inside the limits, it proceeds to
PayPal (sandbox). Outside the limits, it is **refused before money moves**,
with the reason written in plain English. Every check and every payment lands
in a ledger, and the person can revoke the mandate instantly.

> Denied purchases never reach PayPal. The refusal happens first, on purpose.

## Architecture

```
server.js          Entry point. Listens on PORT (default 3100).
app.js             Express routes (pages + JSON API).
lib/mandate.js     Mandate creation, HMAC-signed tokens, the permission check.
lib/agent.js       Deterministic demo agent: fixed catalog, keyword intent
                   parsing, purchase plan, run report.
lib/paypal.js      PayPal Orders API v2 (sandbox), or labeled demo mode.
lib/pages.js       Server-rendered pages (inline CSS, no build step).
lib/store.js       Tiny JSON-file store at data/db.json.
test/              node:test unit tests for the mandate checks.
```

**Token format:** `base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload, secret))`.
The payload carries the mandate id and limits; the server-side record is the
source of truth for status (active / revoked). Change one character of the
token and the signature check fails.

**The check** (runs before every payment) verifies: signature valid, mandate
exists, not revoked, not expired, amount within the per-purchase cap,
amount + this month's completed payments within the monthly cap, category in
the allowlist (case-insensitive), payee in the allowlist when one is set.

**Data:** state lives in `data/db.json` (`{ mandates: [], ledger: [] }`),
created on first write. Delete it to reset the demo.

## Setup

```bash
npm install
npm start            # http://localhost:3100
```

Requires Node.js >= 20. The only runtime dependency is Express.

### Environment variables

| Variable                | Purpose                                             | Default                        |
| ----------------------- | --------------------------------------------------- | ------------------------------ |
| `PORT`                  | Port to listen on                                   | `3100`                         |
| `MANDATE_SECRET`        | Secret used to sign mandate tokens (set in prod!)   | `mandate-dev-secret-change-me` |
| `PAYPAL_CLIENT_ID`      | PayPal sandbox app client id (enables real sandbox) | unset = demo mode              |
| `PAYPAL_CLIENT_SECRET`  | PayPal sandbox app secret                           | unset = demo mode              |
| `DATA_FILE`             | Path of the JSON data store                         | `data/db.json`                 |

### PayPal sandbox keys (optional)

Without PayPal credentials the app runs in clearly labeled **DEMO MODE**: the
permission checks, refusals, agent, and ledger are all fully real; only the
payment step is simulated, and ledger entries say so. The banner at the top of
every page shows which mode you are in.

To run real sandbox payments:

1. Go to [developer.paypal.com](https://developer.paypal.com) and sign in with
   a PayPal account.
2. Open **Apps & Credentials**, switch to **Sandbox**, and create an app.
3. Copy its **Client ID** and **Secret**, then:

```bash
PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... npm start
```

Payments then use the Orders API v2 against `https://api-m.sandbox.paypal.com`:
an order is created with intent CAPTURE and a capture is attempted
server-side. A fresh order normally needs buyer approval before capture, so
when capture is refused the created order stands as the payment proof and the
ledger entry is marked `order_created`. **Credentials are never hardcoded**;
they are read from the environment only.

## Tests

```bash
npm test
```

Unit tests (node:test) cover: happy path allowed; tampered signature rejected
(both signature and payload tampering); over per-purchase cap refused; monthly
cap accumulation refused (and that unpaid checks do not eat the cap); wrong
category refused; payee allowlist enforced; expired refused; revoked refused;
and the agent's catalog planning.

## Demo walkthrough (the 3-minute script)

Open the app and click **Start the 2-minute tour** on the home page, or follow
the same steps manually:

1. **Grant (about 20 seconds).** On `/grant`, keep the defaults: grantor
   "Jordan Rivera", agent "OfficeBot", **$100 per purchase, $500 per month**,
   categories "Office supplies, Electronics, Groceries", no payee allowlist,
   30 days. Click **Sign and grant this mandate**. Point at the signed token:
   the agent carries this pass, and tampering with it breaks the signature.
2. **Agent buys inside the limits (about 40 seconds).** On `/agent`, click
   **Preset: Restock office (inside limits)**. The agent buys printer paper
   ($12.99), coffee pods ($24.00), notebooks ($9.75), and whiteboard markers
   ($7.49), each checked against the pass first, each paid. Read the run
   report aloud: it is written for a person, not a log file.
3. **Agent gets refused (about 30 seconds).** Click **Preset: Buy a laptop
   (outside limits)**. The $1,299 laptop breaks the $100 per-purchase cap, so
   it is refused **before** any money moves. It never reaches PayPal.
4. **Ledger (about 30 seconds).** On `/ledger`, show both runs side by side:
   allowances and the refusal, each with its plain-English reason and the
   running monthly total. This is the record a dispute gets settled from.
5. **Revoke (about 30 seconds).** Back on the mandate pass page, click
   **Revoke instantly**, then run the agent once more: every item is now
   refused with "Mandate has been revoked". Permission that cannot be taken
   back is not permission; this one can, instantly.

Optional closer: call `POST /api/verify` with a tampered token and show the
signature refusal, or keep spending until the monthly cap refuses a small
purchase, proving the caps accumulate.

## API summary

| Route                          | What it does                                                        |
| ------------------------------ | ------------------------------------------------------------------- |
| `POST /api/mandates`           | Create a mandate (JSON). Fields: `grantorName`, `agentLabel`, `perTxCap`, `monthlyCap`, `categories`, `payees`, `expiryDays`. |
| `GET /mandate/:id`             | The pass page: limits, signed token, status, revoke button.         |
| `POST /api/mandates/:id/revoke`| Revoke a mandate instantly.                                         |
| `POST /api/verify`             | Check `{ token, amount, category, payee }` → `{ allowed, reasons }`. Writes a ledger entry. |
| `POST /api/agent/run`          | Run the demo agent with `{ mandateId, instruction }`.               |
| `GET /ledger`, `GET /api/ledger` | The ledger page / JSON.                                           |

## License

MIT. See [LICENSE](LICENSE).
