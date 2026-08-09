// api/create-order.js

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { amount } = req.body || {};
  const EXPECTED_AMOUNT = 1;

  if (Number(amount) !== EXPECTED_AMOUNT) {
    return res.status(400).json({ error: "Invalid amount" });
  }

  const appId = process.env.CASHFREE_APP_ID;
  const secretKey = process.env.CASHFREE_SECRET_KEY;
  const env = (process.env.CASHFREE_ENV || "sandbox").toLowerCase();
  const siteUrl = process.env.SITE_URL;

  if (!appId || !secretKey || !siteUrl) {
    return res.status(500).json({
      error: "Server is not configured yet (missing env vars)."
    });
  }

  const baseUrl =
    env === "production"
      ? "https://api.cashfree.com/pg/orders"
      : "https://sandbox.cashfree.com/pg/orders";

  const orderId =
    "order_" +
    Date.now() +
    "_" +
    Math.random().toString(36).slice(2, 8);

  try {
    const cfRes = await fetch(baseUrl, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "x-api-version": "2023-08-01",
        "x-client-id": appId,
        "x-client-secret": secretKey
      },

      body: JSON.stringify({
        order_id: orderId,
        order_amount: EXPECTED_AMOUNT,
        order_currency: "INR",

        customer_details: {
          customer_id: "cust_" + Date.now(),
          customer_phone: "9999999999"
        },

        order_meta: {
          return_url:
            `${siteUrl}/success.html?order_id={order_id}`
        }
      })
    });

    const data = await cfRes.json();

    if (!cfRes.ok) {
      return res.status(500).json({
        error:
          data.message ||
          "Cashfree order creation failed"
      });
    }

    return res.status(200).json({
      paymentSessionId: data.payment_session_id,
      orderId,
      mode:
        env === "production"
          ? "production"
          : "sandbox"
    });

  } catch (err) {
    console.error(err);

    return res.status(500).json({
      error: "Could not reach Cashfree"
    });
  }
}
