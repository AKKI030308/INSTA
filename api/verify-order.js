// api/verify-order.js

export default async function handler(req, res) {

  const { order_id } = req.query;

  if (!order_id) {
    return res.status(400).send("Missing order_id");
  }

  const appId =
    process.env.CASHFREE_APP_ID;

  const secretKey =
    process.env.CASHFREE_SECRET_KEY;

  const env =
    (process.env.CASHFREE_ENV || "sandbox")
      .toLowerCase();

  const telegramLink =
    process.env.TELEGRAM_GROUP_LINK;

  if (!appId || !secretKey || !telegramLink) {
    return res.status(500).send(
      "Server configuration is incomplete."
    );
  }

  const baseUrl =
    env === "production"
      ? `https://api.cashfree.com/pg/orders/${encodeURIComponent(order_id)}`
      : `https://sandbox.cashfree.com/pg/orders/${encodeURIComponent(order_id)}`;

  try {

    const cfRes = await fetch(baseUrl, {

      method: "GET",

      headers: {
        "x-api-version": "2023-08-01",
        "x-client-id": appId,
        "x-client-secret": secretKey
      }

    });

    const order =
      await cfRes.json();

    if (!cfRes.ok) {

      return res.redirect(
        "/index.html?payment=error"
      );

    }

    if (order.order_status === "PAID") {

      // Payment verified by Cashfree.
      // Telegram link remains server-side.

      res.writeHead(302, {
        Location: telegramLink
      });

      return res.end();
    }

    // Payment was not confirmed.

    res.writeHead(302, {
      Location:
        "/index.html?payment=incomplete"
    });

    return res.end();

  } catch (err) {

    console.error(
      "Cashfree verification error:",
      err
    );

    res.writeHead(302, {
      Location:
        "/index.html?payment=error"
    });

    return res.end();
  }
}
