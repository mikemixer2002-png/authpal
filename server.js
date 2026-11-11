'use strict';

const app = require('./app');

const PORT = process.env.PORT || 3100;

app.listen(PORT, () => {
  console.log(`AuthPal listening on http://localhost:${PORT}`);
  const paypal = require('./lib/paypal');
  console.log(
    paypal.configured()
      ? 'PayPal: sandbox mode (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET found)'
      : 'PayPal: DEMO MODE (no PayPal credentials set; payments are simulated and labeled as such)'
  );
});
