// api/verify-order.js
// Cashfree payment verification + one-time Telegram invite.
// Requirements:
//   CASHFREE_APP_ID
//   CASHFREE_SECRET_KEY
//   CASHFREE_ENV = sandbox | production
//   TELEGRAM_BOT_TOKEN
//   TELEGRAM_CHAT_ID
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN

const INVITE_TTL_SECONDS = 30;
const ORDER_LOCK_TTL_SECONDS = 120;
const ORDER_RECORD_TTL_SECONDS = 7 * 24 * 60 * 60;

async function redis(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error("Upstash Redis is not configured.");
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    throw new Error(data.error || "Redis request failed.");
  }

  return data.result;
}

async function telegram(method, payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
  }

  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );

  const data = await response.json();

  if (!response.ok || !data.ok) {
    throw new Error(
      data.description || `Telegram ${method} request failed.`
    );
  }

  return data.result;
}

function redirect(res, location) {
  return res.redirect(302, location);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).send("Method not allowed");
  }

  const { order_id } = req.query;

  if (!order_id || typeof order_id !== "string") {
    return res.status(400).send("Missing order_id");
  }

  const appId = process.env.CASHFREE_APP_ID;
  const secretKey = process.env.CASHFREE_SECRET_KEY;
  const env = (process.env.CASHFREE_ENV || "sandbox").toLowerCase();
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!appId || !secretKey || !chatId) {
    return res.status(500).send("Server configuration is incomplete.");
  }

  const baseUrl =
    env === "production"
      ? `https://api.cashfree.com/pg/orders/${encodeURIComponent(order_id)}`
      : `https://sandbox.cashfree.com/pg/orders/${encodeURIComponent(order_id)}`;

  try {
    // 1) Verify the payment directly with Cashfree.
    const cfRes = await fetch(baseUrl, {
      method: "GET",
      headers: {
        "x-api-version": "2023-08-01",
        "x-client-id": appId,
        "x-client-secret": secretKey,
        Accept: "application/json",
      },
    });

    const order = await cfRes.json();

    if (!cfRes.ok || order.order_status !== "PAID") {
      return redirect(res, "/index.html?payment=incomplete");
    }

    // 2) Reserve this order exactly once.
    // Redis SET NX is atomic, so two simultaneous requests cannot create
    // two different Telegram invite links for the same paid order.
    const key = `telegram:paid-order:${order_id}`;

    const reservation = await redis([
      "SET",
      key,
      JSON.stringify({
        status: "CREATING",
        createdAt: new Date().toISOString(),
      }),
      "NX",
      "EX",
      ORDER_LOCK_TTL_SECONDS,
    ]);

    if (reservation === null) {
      // This order was already processed or another request is creating
      // its invite. Never generate another invite for the same payment.
      const existing = await redis(["GET", key]);

      if (existing) {
        let record;
        try {
          record = JSON.parse(existing);
        } catch {
          record = null;
        }

        if (record?.status === "READY" && record.inviteLink) {
          return redirect(res, record.inviteLink);
        }

        if (record?.status === "USED") {
          return res.status(409).send("This payment has already been used.");
        }

        return res
          .status(409)
          .send("Your Telegram access is being created. Please try again.");
      }

      return res
        .status(409)
        .send("This payment has already been used.");
    }

    try {
      // 3) Create a fresh invite:
      //    - expires in 30 seconds
      //    - maximum 1 member
      const expireDate = Math.floor(Date.now() / 1000) + INVITE_TTL_SECONDS;

      const invite = await telegram("createChatInviteLink", {
        chat_id: chatId,
        name: `Paid ${order_id}`.slice(0, 32),
        expire_date: expireDate,
        member_limit: 1,
        creates_join_request: false,
      });

      const record = {
        status: "READY",
        orderId: order_id,
        inviteLink: invite.invite_link,
        expiresAt: new Date(expireDate * 1000).toISOString(),
        createdAt: new Date().toISOString(),
      };

      // Keep the exact same invite for this order on retries.
      await redis([
        "SET",
        key,
        JSON.stringify(record),
        "EX",
        ORDER_RECORD_TTL_SECONDS,
      ]);

      return redirect(res, invite.invite_link);
    } catch (err) {
      // Allow a retry if Telegram/Redis failed while creating the invite.
      try {
        await redis(["DEL", key]);
      } catch {}

      console.error("Telegram invite creation error:", err);
      return res
        .status(500)
        .send("Payment is verified, but Telegram access could not be created.");
    }
  } catch (err) {
    console.error("Payment verification error:", err);
    return redirect(res, "/index.html?payment=error");
  }
}
