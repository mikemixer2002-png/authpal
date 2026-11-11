'use strict';

// The demo agent: deterministic, no LLM. It reads a plain instruction,
// matches it against a fixed catalog by keyword, builds a purchase plan,
// then runs every planned item through the mandate check. Allowed items are
// paid (PayPal sandbox or demo mode); refused items never reach PayPal.
// Every attempt, allowed or refused, lands in the ledger.

const crypto = require('crypto');
const { checkMandate, spentThisMonth } = require('./mandate');
const paypal = require('./paypal');
const store = require('./store');

const CATALOG = [
  { name: 'Printer paper',        price: 12.99,   category: 'Office supplies', payee: 'OfficeMart',    keywords: ['printer paper', 'paper'] },
  { name: 'Coffee pods',          price: 24.0,    category: 'Office supplies', payee: 'OfficeMart',    keywords: ['coffee pods', 'coffee'] },
  { name: 'Notebooks',            price: 9.75,    category: 'Office supplies', payee: 'OfficeMart',    keywords: ['notebooks', 'notebook'] },
  { name: 'Whiteboard markers',   price: 7.49,    category: 'Office supplies', payee: 'OfficeMart',    keywords: ['whiteboard markers', 'markers', 'whiteboard'] },
  { name: 'Coffee beans (5 lb)',  price: 18.5,    category: 'Groceries',       payee: 'FreshMart',     keywords: ['coffee beans', 'beans'] },
  { name: 'Wireless mouse',       price: 29.99,   category: 'Electronics',     payee: 'TechSupply Co', keywords: ['wireless mouse', 'mouse'] },
  { name: 'USB-C cable pack',     price: 15.99,   category: 'Electronics',     payee: 'TechSupply Co', keywords: ['usb-c', 'cable', 'cables'] },
  { name: 'Laptop',               price: 1299.0,  category: 'Electronics',     payee: 'TechSupply Co', keywords: ['laptop'] },
  { name: 'Team lunch (pizzas)',  price: 86.4,    category: 'Food',            payee: 'Slice House',   keywords: ['pizza', 'pizzas', 'team lunch', 'lunch'] },
  { name: 'Flight to Denver',     price: 342.0,   category: 'Travel',          payee: 'SkyAir',        keywords: ['flight', 'plane ticket', 'fly'] },
  { name: 'Antivirus subscription', price: 59.99, category: 'Software',        payee: 'SoftServe',     keywords: ['antivirus', 'software subscription'] },
];

// Keyword intent parsing: an item is planned if any of its keywords appears
// in the instruction. Order follows the catalog, so plans are deterministic.
function planPurchase(instruction) {
  const text = String(instruction || '').toLowerCase();
  return CATALOG.filter((item) =>
    item.keywords.some((k) => text.includes(k))
  );
}

function money(n) {
  return '$' + Number(n).toFixed(2);
}

// Runs the agent for one mandate + instruction. Mutates db (ledger) and saves.
// Returns { plan, results, report, totals }.
async function runAgent(db, mandate, instruction) {
  const plan = planPurchase(instruction);
  const results = [];
  const report = [];
  let spent = 0;

  if (plan.length === 0) {
    report.push(
      'I could not find anything in the demo catalog matching that instruction, so I bought nothing.'
    );
    return { plan, results, report, spent };
  }

  for (const item of plan) {
    const check = checkMandate(db, {
      token: mandate.token,
      amount: item.price,
      category: item.category,
      payee: item.payee,
    });

    const entry = {
      id: 'l_' + crypto.randomBytes(6).toString('hex'),
      ts: new Date().toISOString(),
      mandateId: mandate.id,
      source: 'agent',
      item: item.name,
      amount: item.price,
      category: item.category,
      payee: item.payee,
      decision: check.allowed ? 'allow' : 'refuse',
      reasons: check.reasons,
      paymentStatus: 'refused',
      paypalOrderId: null,
      paymentDetail: null,
    };

    if (check.allowed) {
      try {
        const payment = await paypal.pay({
          amount: item.price,
          description: `${item.name} via AuthPal agent`,
        });
        entry.paymentStatus = payment.status; // captured | order_created | demo
        entry.paypalOrderId = payment.orderId;
        entry.paymentDetail = payment.detail;
        spent += item.price;
        report.push(
          `Bought ${item.name} for ${money(item.price)} from ${item.payee} (${payment.detail}).`
        );
      } catch (err) {
        entry.paymentStatus = 'payment_error';
        entry.paymentDetail = String(err.message || err);
        report.push(
          `Approved by the mandate, but the PayPal step failed for ${item.name}: ${entry.paymentDetail}.`
        );
      }
    } else {
      report.push(`Refused ${item.name} (${money(item.price)}): ${check.reasons.join('; ')}.`);
    }

    db.ledger.push(entry);
    results.push(entry);
  }

  if (spent > 0) report.push(`Total spent in this run: ${money(spent)}.`);
  report.push(
    `Spent so far this month under this mandate: ${money(spentThisMonth(db, mandate.id))} of ${money(mandate.monthlyCap)}.`
  );

  store.save(db);
  return { plan, results, report, spent };
}

module.exports = { CATALOG, planPurchase, runAgent };
