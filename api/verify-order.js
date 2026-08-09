// api/verify-order.js

export default async function handler(req, res) {
  const { order_id } = req.query;

  if (!order_id) {
    return res.status(400).send("Missing order_id");
  }

  const appId = process.env.CASHFREE_APP_ID;
  const secretKey = process.env.CASHFREE_SECRET_KEY;
  const env = (process.env.CASHFREE_ENV || "sandbox").toLowerCase();
  const telegramLink = process.env.TELEGRAM_GROUP_LINK;

  if (!appId || !secretKey || !telegramLink) {
    return res.status(500).send("Server configuration is incomplete.");
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

    const order = await cfRes.json();

    if (!cfRes.ok) {
      return res.redirect(302, "/index.html?payment=error");
    }

    // ONLY verified PAID orders get Telegram redirect
    if (order.order_status === "PAID") {
      return res.redirect(302, telegramLink);
    }

    // Failed / pending / cancelled
    return res.redirect(302, "/index.html?payment=incomplete");

  } catch (err) {
    console.error("Cashfree verification error:", err);
    return res.redirect(302, "/index.html?payment=error");
  }
}
