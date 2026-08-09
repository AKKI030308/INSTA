// api/create-order.js
// Runs on Vercel as a serverless function. Creates a Cashfree order and
// returns a payment_session_id to the browser. Secret keys stay server-side.
//
// Required environment variables (set these in Vercel Project Settings -> Environment Variables,
// never commit them to GitHub):
//   CASHFREE_APP_ID
//   CASHFREE_SECRET_KEY
//   CASHFREE_ENV            = "sandbox" or "production"
//   SITE_URL                = e.g. https://your-app.vercel.app

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { amount } = req.body || {};
  const EXPECTED_AMOUNT = 499; // keep this in sync with the price shown on the page

  if (Number(amount) !== EXPECTED_AMOUNT) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  const appId = process.env.CASHFREE_APP_ID;
  const secretKey = process.env.CASHFREE_SECRET_KEY;
  const env = process.env.CASHFREE_ENV || 'sandbox';
  const siteUrl = process.env.SITE_URL;

  if (!appId || !secretKey || !siteUrl) {
    return res.status(500).json({ error: 'Server is not configured yet (missing env vars).' });
  }

  const baseUrl = env === 'production'
    ? 'https://api.cashfree.com/pg/orders'
    : 'https://sandbox.cashfree.com/pg/orders';

  const orderId = 'order_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

  try {
    const cfRes = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-version': '2023-08-01',
        'x-client-id': appId,
        'x-client-secret': secretKey
      },
      body: JSON.stringify({
        order_id: orderId,
        order_amount: EXPECTED_AMOUNT,
        order_currency: 'INR',
        customer_details: {
          // In production, collect a real customer_id/phone/email from the
          // subscriber (e.g. via a short form) instead of placeholders.
          customer_id: 'cust_' + Date.now(),
          customer_phone: '9999999999'
        },
        order_meta: {
          // return_url is where Cashfree sends the browser after payment.
          // That page (public/return.html) calls /api/verify-payment.
          return_url: `${siteUrl}/return.html?order_id={order_id}`
        }
      })
    });

    const data = await cfRes.json();

    if (!cfRes.ok) {
      return res.status(500).json({ error: data.message || 'Cashfree order creation failed' });
    }

    return res.status(200).json({
      paymentSessionId: data.payment_session_id,
      orderId,
      mode: env === 'production' ? 'production' : 'sandbox'
    });
  } catch (err) {
    return res.status(500).json({ error: 'Could not reach Cashfree' });
  }
}
