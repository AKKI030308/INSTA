// api/verify-order.js
// Cashfree PAID -> one fresh Telegram invite -> direct Telegram redirect.
// Same order_id can never create a second invite.

const INVITE_SECONDS = 30;
const PROCESSING_LOCK_SECONDS = 90;
const USED_ORDER_SECONDS = 365 * 24 * 60 * 60;

async function redis(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Missing Upstash Redis env vars.");

  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command)
  });
  const data = await r.json();
  if (!r.ok || data.error) throw new Error(data.error || "Redis request failed.");
  return data.result;
}

async function makeInvite() {
  const bot = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!bot || !chat) throw new Error("Missing Telegram env vars.");

  const expireDate = Math.floor(Date.now() / 1000) + INVITE_SECONDS;
  const r = await fetch(`https://api.telegram.org/bot${bot}/createChatInviteLink`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, name: "Paid access", expire_date: expireDate, member_limit: 1 })
  });
  const data = await r.json();
  if (!r.ok || !data.ok || !data.result?.invite_link) {
    console.error("Telegram error:", data);
    throw new Error(data.description || "Telegram invite creation failed.");
  }
  return data.result.invite_link;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).send("Method not allowed");

  const orderId = String(req.query?.order_id || "").trim();
  if (!orderId) return res.redirect(302, "/index.html?payment=error");

  const appId = process.env.CASHFREE_APP_ID;
  const secret = process.env.CASHFREE_SECRET_KEY;
  const env = (process.env.CASHFREE_ENV || "sandbox").toLowerCase();
  if (!appId || !secret) return res.redirect(302, "/index.html?payment=error");

  const cashfreeUrl = env === "production"
    ? `https://api.cashfree.com/pg/orders/${encodeURIComponent(orderId)}`
    : `https://sandbox.cashfree.com/pg/orders/${encodeURIComponent(orderId)}`;

  try {
    const cfRes = await fetch(cashfreeUrl, {
      method: "GET",
      headers: {
        "x-api-version": "2023-08-01",
        "x-client-id": appId,
        "x-client-secret": secret,
        Accept: "application/json"
      }
    });
    const order = await cfRes.json();

    console.log("Cashfree verification:", {
      orderId,
      httpStatus: cfRes.status,
      orderStatus: order?.order_status
    });

    if (!cfRes.ok) return res.redirect(302, "/index.html?payment=error");
    if (order?.order_status !== "PAID") return res.redirect(302, "/index.html?payment=incomplete");

    const key = `telegram:paid-order:${orderId}`;
    const reservation = await redis([
      "SET", key,
      JSON.stringify({ status: "PROCESSING", orderId, createdAt: new Date().toISOString() }),
      "NX", "EX", PROCESSING_LOCK_SECONDS
    ]);

    if (reservation === null) {
      const existingRaw = await redis(["GET", key]);
      if (existingRaw) {
        let existing = null;
        try { existing = JSON.parse(existingRaw); } catch {}
        if (existing?.status === "READY" && existing.inviteLink) {
          return res.redirect(302, existing.inviteLink);
        }
      }
      return res.status(409).send("This payment is already being processed or has already been used.");
    }

    try {
      const inviteLink = await makeInvite();
      await redis([
        "SET", key,
        JSON.stringify({ status: "READY", orderId, inviteLink, createdAt: new Date().toISOString() }),
        "EX", USED_ORDER_SECONDS
      ]);
      return res.redirect(302, inviteLink);
    } catch (err) {
      console.error("Telegram access error:", err);
      try { await redis(["DEL", key]); } catch {}
      return res.status(500).send("Payment was successful, but Telegram access could not be created.");
    }
  } catch (err) {
    console.error("verify-order error:", err);
    return res.redirect(302, "/index.html?payment=error");
  }
}
