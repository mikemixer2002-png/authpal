# AuthPal upgrades

Status note, read first: this file covers the whole upgrade package.
Items 5 and 6 (pass card visual, mobile pass) were added first, on
2026-11-11. Items 1 to 4 (MCP server, single-use passes, seller-check
page, PayPal capture completion) were built afterward, also 2026-11-11,
and are documented in their own sections below. Full suite after all six
items: `npm test` reports 21 tests, 21 pass, 0 fail.

Presentation, per the owner's standard: every new surface uses the shared
layout and the existing components (cards, pills, the same form rhythm),
so nothing reads as bolted on. The single-use control is one quiet field
inside the existing grant form, the seller page mirrors the grant page,
and the MCP capability gets one small section on the home page. The pass
card stays the visual center of the product; nothing added competes with
it.

## 1. MCP server

Files changed: `lib/mcp.js` (new), `app.js` (the `POST /mcp` route).

A Model Context Protocol endpoint at `POST /mcp`, hand-rolled JSON-RPC 2.0
over HTTP with no new dependencies. Stateless: `initialize`, `ping`,
`tools/list`, and `tools/call` are supported; notifications are accepted
with a 202 and no body; batches work; unknown methods return -32601 and
unknown tools -32602. The four tools are thin doors into the existing
library functions, not parallel logic:

- `grant_pass` calls `createMandate`, exactly like `POST /api/mandates`,
  and returns the pass including its signed token.
- `check_purchase` accepts a token or a `mandateId`, runs `checkMandate`,
  and writes a ledger entry (source `mcp`, status `not_attempted` when
  allowed). It never calls PayPal.
- `pay_with_pass` runs the same check and, when allowed, pays through the
  existing `lib/paypal.js` path, exactly like an agent run. Refusals are
  recorded and never reach PayPal.
- `revoke_pass` reuses the app's own revoke path.

On the site, the capability is presented as one understated card on the
home page ("For agent frameworks"), naming the endpoint and the four
tools in two sentences. Nothing else on the home page changed.

## 2. Single-use passes (maxUses)

Files changed: `lib/mandate.js`, `lib/pages.js` (grant form, pass page),
`app.js` (passes the usage count to the pass page).

- Creation takes an optional `maxUses` (positive whole number). Absent or
  blank means no limit, and the stored field is null. When set, the value
  is also carried in the signed payload. Validation rejects 0, negatives,
  and fractions.
- The check counts a use the same way the monthly cap counts spend:
  ledger entries for this pass, decided allow, with a paid payment status
  (`captured`, `order_created`, or `demo`), in the current calendar
  month. Refused checks and verify-only checks never consume a use.
- Refusal reasons are plain: "This pass was single-use and has already
  been used" for a limit of 1, and "This pass allows N purchases per
  month and all of them have been used" above that.
- Backward compatibility: the check reads the stored record, not the
  payload, so tokens issued before this field existed verify unchanged.
  A dedicated test rebuilds a pre-upgrade token (no maxUses in the
  payload) and confirms it is allowed, and records with the field deleted
  behave as unlimited.
- Presentation: the grant form gains exactly one line after the expiry
  field, a "Purchases per month" number input with the note that blank
  means no limit and 1 means single-use. The pass detail page shows one
  added row ("Purchases: X of N used this month") only on passes that
  have a limit. The pass card itself is untouched.

## 3. Seller-check page

Files changed: `lib/pages.js` (new `sellerPage`, one nav link),
`app.js` (the `GET /seller` route).

`GET /seller` renders a page in the shared layout: one short paragraph
("A pass works anywhere. Any seller can check it before accepting an
agent's order.") and one form card in the grant page's style: pass token,
item, amount, category, seller name. The form posts to the existing
`POST /api/verify`, so the seller goes through the identical check (and
ledger entry) as everyone else, and the verdict renders as the ALLOW or
REFUSE pill with its reasons listed. No login. "Seller check" joins the
nav between Agent and Ledger, in the same type and spacing as the other
links. Because the page uses the shared layout, the item 6 media query
applies to it; it was confirmed rendering at desktop width in the smoke
run and was not separately screenshot-checked at 390px in this pass.

## 4. PayPal capture completion

Files changed: `lib/paypal.js`, `lib/agent.js`, `lib/mcp.js`,
`app.js` (the capture route, usage data for the pass page),
`lib/pages.js` (approval links in the ledger and on the pass page).

- `pay()` now reads the created order's links and returns the approval
  link (`approveUrl`, from the `payer-action` link, falling back to
  `approve`). Ledger entries written by the agent and by `pay_with_pass`
  carry it.
- Where an order is waiting, the offer is quiet: the ledger's payment
  cell gains one "Approve in PayPal" link under the order id, and the
  pass page gains one plain section, "Waiting on PayPal approval",
  listing each open order with its link. Orders in any other state show
  nothing new.
- `POST /api/orders/:orderId/capture` looks up the newest ledger entry
  for the order (404 with a JSON error when there is none) and calls the
  new `captureOrder()` in `lib/paypal.js`. On a confirmed capture the
  entry becomes `captured`. `captureOrder()` never throws: in demo mode,
  on a network failure, and on a PayPal refusal it returns a clear error,
  including a specific one when the buyer has not approved yet
  (`ORDER_NOT_APPROVED`), and the route answers 422 with that message.
- The ledger detail wording no longer says capture needs buyer approval
  as a dead end. It now reads: "PayPal sandbox order created (approve in
  PayPal, then capture to complete the payment)".
- The proven flow is unchanged apart from the added field: order creation
  and the best-effort immediate capture behave exactly as before.
- Not exercised live: this pass ran entirely in demo mode, so the
  approve-then-capture round trip against the real sandbox was not run
  here. The sandbox path is the same Orders endpoints the app already
  uses, and every failure mode that can occur before approval is handled
  and tested, but the happy-path capture after a real buyer approval
  remains unverified until someone runs it with sandbox credentials.

## Tests and smoke run for items 1 to 4

New file: `test/upgrades.test.js` (10 tests). Covered: single-use refusal
on the second paid purchase (and that a verify-only entry does not consume
the use); a limit of 2 allowing exactly two; default null staying
unlimited, including a record with the field deleted; invalid limits
rejected at creation; a rebuilt pre-upgrade token still verifying;
`captureOrder` failing gracefully in demo mode; over HTTP against the real
app on an ephemeral port: MCP initialize, ping, tools/list, unknown method
and tool errors, notification handling, and a full grant, check, pay,
revoke round trip with the ledger entries inspected; a single-use refusal
through `pay_with_pass`; the seller page rendering in the shared layout;
and the capture route's 404.

Full suite: `npm test` reports 21 tests, 21 pass, 0 fail (the 11
pre-existing tests plus the 10 new ones).

Smoke run: the app was booted in demo mode (no PayPal env vars) with
`DATA_FILE` pointed at a throwaway file, and driven over HTTP. Observed,
in order: initialize answered for server "authpal"; `grant_pass` created
pass m_441eacc212e5 with maxUses 1; `check_purchase` allowed;
`POST /api/verify` (the seller path) allowed; first `pay_with_pass`
allowed with payment status "demo"; second `pay_with_pass` refused with
"This pass was single-use and has already been used"; `GET /seller`
returned 200 and the nav link was present on the home page; `revoke_pass`
returned "revoked"; a final verify was refused with "This pass has been
revoked"; and capturing an unknown order returned the clean 404 JSON
error. Nothing was pushed, deployed, or submitted.

## 5. Pass card visual

File changed: `lib/pages.js` (function `mandatePage`, plus new `.passcard`
CSS in the shared style block).

The pass detail page now opens with a designed pass card, boarding-pass
style, above the existing details card:

- Brand line: AUTHPAL, with the pass status pill (ACTIVE, REVOKED, EXPIRED)
  on the right.
- Tagline: "The permission slip for AI money."
- Grantor and agent, with the line "grants spending permission to" between
  them.
- A four-cell grid: per-purchase cap, monthly cap, allowed categories,
  expiry date.
- A stub section below a dashed perforation line: the signature fingerprint
  (the first 16 characters of the token's signature segment, followed by an
  ellipsis) and the pass ID.

Pure HTML and CSS in the existing dark slate and gold style system. No
images, no JavaScript, no frameworks. The existing elements stay below the
card, unchanged: status, the full details list, the signed token box, the
revoke button, and the agent and ledger links.

Small copy fix in the same function: the revoke confirm dialog now says
"Revoke this pass?" instead of using the word mandate, matching the rule
that UI copy uses the noun "pass".

## 6. Mobile pass (responsive pages)

File changed: `lib/pages.js` (one `@media (max-width: 640px)` block added to
the shared CSS, so every page that uses the common layout inherits it).

What the block does:

- Content padding tightens; headings step down a size.
- The header nav moves to its own full-width row and wraps, so the brand,
  nav links, and the PayPal mode pill never collide.
- The pass detail key/value grid stacks to one column.
- Tables scroll horizontally inside their own container instead of pushing
  the page wide (the ledger table and the agent catalog table).
- Buttons and links get a 44px minimum tap height; form fields go to 16px
  text so mobile browsers do not auto-zoom on focus.
- The stats grid narrows its minimum cell so it stays two-up on a phone.
- The pass card stacks its grantor/agent row and keeps its grid two-up.

Verification method: actually rendered, not just CSS reasoning. The app was
run locally in demo mode with a seeded pass and two agent runs (a restock
that was allowed and a laptop that was refused, so the ledger had rows). The
pages were loaded in the headless Chromium shell at a 390 by 844 mobile
viewport (device scale factor 2) through the DevTools protocol, and two
things were checked per page:

- Measured: `document.documentElement.scrollWidth` equals `window.innerWidth`
  (390) on every page: home, tour, grant, pass, agent, ledger. No horizontal
  page overflow anywhere.
- Looked at: screenshots of the pass page and the ledger at 390px. The pass
  card reads cleanly, the header nav wraps to its own row, the ledger table
  scrolls inside its card while the page itself stays put.

The seller page listed in the original item could not be checked because the
`/seller` route does not exist yet (see the status note above). When it is
built with the shared layout, it inherits these rules automatically.

Addendum (later the same day): the `/seller` route has since been built
with the shared layout (see item 3), so these rules do apply to it. It was
not separately re-rendered at 390px after being built.

## Tests

New file: `test/pages.test.js` (2 tests).

- Pass detail page renders the designed pass card at the top: brand, grantor,
  agent, both caps, categories, status pill, the 16-character signature
  fingerprint on the card (and not the longer signature), with the existing
  details, token box, and revoke button still present below.
- Pages ship the small-screen responsive rules (the 640px media query, the
  wrapping nav, the stacking detail grid, the scrolling tables).

Full suite: `npm test` reports 11 tests, 11 pass, 0 fail (the 9 pre-existing
mandate and agent tests plus the 2 new page tests).

Nothing was pushed, deployed, or submitted. Changes live in the working
tree: `lib/pages.js` modified, `test/pages.test.js` and this file added.
