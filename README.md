# AuthPal

**The permission slip for AI money.**

AI agents have started spending money on our behalf: restocking offices, booking
travel, paying for software. Payments were built for a person pressing a button,
so there is no standard way to prove what the person actually allowed an agent
to spend: how much, for what, from whom, and until when.

AuthPal fixes that. A person grants an agent a **signed, limited permission**
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
lib/mandate.js     Pass creation, HMAC-signed tokens, the permission check.
lib/agent.js       Deterministic demo agent: fixed catalog, keyword intent
                   parsing, purchase plan, run report.
lib/mcp.js         Model Context Protocol endpoint (JSON-RPC 2.0): the same
                   passes offered as tools to agent frameworks.
lib/paypal.js      PayPal Orders API v2 (sandbox), or labeled demo mode.
lib/pages.js       Server-rendered pages (inline CSS, no build step).
lib/store.js       Tiny JSON-file store at data/db.json.
test/              node:test tests for the checks, the pages, and the
                   upgrade package (MCP, limited-use passes, capture).
```

**Token format:** `base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload, secret))`.
The payload carries the mandate id and limits; the server-side record is the
source of truth for status (active / revoked). Change one character of the
token and the signature check fails.

**The check** (runs before every payment) verifies: signature valid, mandate
exists, not revoked, not expired, amount within the per-purchase cap,
amount + this month's completed payments within the monthly cap, fewer
completed purchases this month than the pass's purchase limit when one is
set, category in the allowlist (case-insensitive), payee in the allowlist
when one is set.

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
server-side. A fresh order normally needs buyer approval first, so the
created order also returns its PayPal approval link. The pass page and the
ledger offer that link as "Approve in PayPal"; once the buyer has approved,
`POST /api/orders/:orderId/capture` completes the payment and the ledger
entry becomes `captured`. Until then the created order stands as the payment
proof and the entry is marked `order_created`. If a capture is attempted
before approval, it fails with a clear reason instead of an error page.
**Credentials are never hardcoded**; they are read from the environment only.

## Limited-use passes

A pass may also carry a purchase limit, set with the optional `maxUses`
field at grant time. Set it to 1 and the pass is single-use; set it higher
and the pass allows that many purchases per month. Only completed payments
count toward the limit: a check that was refused, or a verify call that
never became a payment, never consumes a use. Once the limit is reached,
later purchases are refused with the reason written out, for example
"This pass was single-use and has already been used". Passes granted without
the field have no purchase limit, and tokens issued before this field
existed still verify exactly as before.

## Seller check

A pass is not tied to this one app. Any seller who is handed a pass token
can confirm it before accepting an agent's order, on the seller check page
at `/seller`: paste the token, enter the amount, category, and seller name,
and the signature and limits are checked on the spot. The page is backed by
`POST /api/verify`, the same check the agent itself goes through, and a
check never charges anything.

## MCP server

AuthPal also speaks the Model Context Protocol, so an agent framework does
not need this website at all. `POST /mcp` accepts JSON-RPC 2.0
(`initialize`, `tools/list`, `tools/call`, `ping`) and offers four tools:

| Tool             | What it does                                                                |
| ---------------- | --------------------------------------------------------------------------- |
| `grant_pass`     | Create a pass (same inputs as `POST /api/mandates`). Returns the signed token. |
| `check_purchase` | Run the permission check and record it in the ledger. Never moves money.    |
| `pay_with_pass`  | Run the check; when allowed, pay through PayPal. Refusals never reach PayPal. |
| `revoke_pass`    | Revoke a pass immediately.                                                  |

The endpoint is stateless, and the same checks apply as everywhere else:
the tools are another door into the pass, not a way around it.

## Tests

```bash
npm test
```

Unit tests (node:test) cover: happy path allowed; tampered signature rejected
(both signature and payload tampering); over per-purchase cap refused; monthly
cap accumulation refused (and that unpaid checks do not eat the cap); wrong
category refused; payee allowlist enforced; expired refused; revoked refused;
and the agent's catalog planning. A second suite covers the upgrade package:
limited-use passes (including that old tokens still verify), the MCP tool
round trip over HTTP (grant, check, pay, revoke), the seller page, and the
capture route's errors.

## Demo walkthrough (the 3-minute script)

Open the app and click **Start the 2-minute tour** on the home page, or follow
the same steps manually:

1. **Grant (about 20 seconds).** On `/grant`, keep the defaults: grantor
   "Jordan Rivera", agent "OfficeBot", **$100 per purchase, $500 per month**,
   categories "Office supplies, Electronics, Groceries", no payee allowlist,
   30 days. Click **Sign and grant this pass**. Point at the signed token:
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
5. **Revoke (about 30 seconds).** Back on the pass page, click
   **Revoke instantly**, then run the agent once more: every item is now
   refused with "This pass has been revoked". Permission that cannot be taken
   back is not permission; this one can, instantly.

Optional closer: call `POST /api/verify` with a tampered token and show the
signature refusal, or keep spending until the monthly cap refuses a small
purchase, proving the caps accumulate.

## API summary

| Route                          | What it does                                                        |
| ------------------------------ | ------------------------------------------------------------------- |
| `POST /api/mandates`           | Create a mandate (JSON). Fields: `grantorName`, `agentLabel`, `perTxCap`, `monthlyCap`, `categories`, `payees`, `expiryDays`, `maxUses` (optional). |
| `GET /mandate/:id`             | The pass page: limits, signed token, status, revoke button.         |
| `POST /api/mandates/:id/revoke`| Revoke a mandate instantly.                                         |
| `POST /api/verify`             | Check `{ token, amount, category, payee }` → `{ allowed, reasons }`. Writes a ledger entry. |
| `POST /api/agent/run`          | Run the demo agent with `{ mandateId, instruction }`.               |
| `GET /seller`                  | The seller check page: any seller can verify a pass before accepting an order. |
| `POST /api/orders/:orderId/capture` | Capture an approved PayPal order and mark its ledger entry `captured`. |
| `POST /mcp`                    | MCP endpoint (JSON-RPC 2.0): `grant_pass`, `check_purchase`, `pay_with_pass`, `revoke_pass`. |
| `GET /ledger`, `GET /api/ledger` | The ledger page / JSON.                                           |

## License

MIT. See [LICENSE](LICENSE).
