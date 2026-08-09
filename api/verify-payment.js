// api/verify-payment.js
// Called by public/return.html after Cashfree sends the user back.
// Confirms the order is actually PAID by asking Cashfree directly
// (never trusts anything from the URL/query string alone), and only
// then redirects the browser into the Telegram group.
//
// Required environment variables (same as create-order.js), plus:
//   TELEGRAM_INVITE_LINK   e.g. https://t.me/+xxxxxxxxxxxx
//
// IMPORTANT: TELEGRAM_INVITE_LINK is never sent to the browser as page
// content or JSON — this function issues an HTTP redirect (302) directly,
// so the raw link never sits in the client-side source or bundle.

export default async function handler(req, res) {
  const { order_id } = req.query;

  if (!order_id) {
    return res.status(400).send('Missing order_id');
  }

  const appId = process.env.CASHFREE_APP_ID;
  const secretKey = process.env.CASHFREE_SECRET_KEY;
  const env = process.env.CASHFREE_ENV || 'sandbox';
  const telegramLink = process.env.TELEGRAM_INVITE_LINK;

  const baseUrl = env === 'production'
    ? `https://api.cashfree.com/pg/orders/${order_id}`
    : `https://sandbox.cashfree.com/pg/orders/${order_id}`;

  try {
    const cfRes = await fetch(baseUrl, {
      headers: {
        'x-api-version': '2023-08-01',
        'x-client-id': appId,
        'x-client-secret': secretKey
      }
    });
    const order = await cfRes.json();

    if (order.order_status === 'PAID') {
      // Verified paid -> redirect straight into Telegram. This works as a
      // deep link on mobile (opens the Telegram app if installed) and falls
      // back to the Telegram web app otherwise.
      res.writeHead(302, { Location: telegramLink });
      return res.end();
    }

    // Not paid (pending/failed/etc.) — send back to the pricing page with a
    // status flag instead of the group link.
    res.writeHead(302, { Location: '/index.html?payment=incomplete' });
    return res.end();
  } catch (err) {
    res.writeHead(302, { Location: '/index.html?payment=error' });
    return res.end();
  }
}
