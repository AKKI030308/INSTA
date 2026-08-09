# Creator Subscription → Cashfree → Telegram

Mobile-friendly paywall page. User pays via Cashfree, payment is verified
**server-side**, and only then is the browser redirected straight into the
Telegram group — the invite link is never present in the page's HTML/JS
source, so it can't be scraped, screenshotted from view-source, or shared
by non-payers.

## How it works
1. `public/index.html` — the pricing page. "Pay & Join Telegram Group"
   button calls `api/create-order`.
2. `api/create-order.js` — creates a Cashfree order server-side (secret
   key never touches the browser), returns a `payment_session_id`.
3. Cashfree's checkout SDK takes over, user pays, Cashfree redirects back
   to `public/return.html?order_id=...`.
4. `return.html` calls `api/verify-payment.js`.
5. `api/verify-payment.js` asks Cashfree directly "is this order actually
   PAID?" — never trusts the URL alone (URLs can be guessed/replayed). If
   and only if Cashfree confirms `PAID`, it issues a real HTTP redirect
   straight to your Telegram invite link (`TELEGRAM_INVITE_LINK` env var).
   If unpaid, user is sent back to the pricing page.

## Before deploying
- [ ] Replace **Your Name / @your_handle** and the avatar in `index.html`
- [ ] Set the real price (must match `EXPECTED_AMOUNT` in `create-order.js`)
- [ ] Add the Cashfree SDK script tag to `index.html`:
      `<script src="https://sdk.cashfree.com/js/v3/cashfree.js"></script>`
- [ ] Fill in real "What subscribers get" content
- [ ] Swap preview thumbnails for real clip frames

## Adding your own photo & preview clips
Real files already wired into `public/media/` — just overwrite them with
your own, **keeping the exact same filenames**, and the page will pick
them up automatically (no code changes needed):

| File | Used for |
|---|---|
| `public/media/avatar.jpg` | Your profile photo (shown at the top) |
| `public/media/clip1-thumb.jpg` | Poster image for preview clip 1 |
| `public/media/clip1-preview.mp4` | Short preview video for clip 1 |
| `public/media/clip2-thumb.jpg` / `clip2-preview.mp4` | Preview clip 2 |
| `public/media/clip3-thumb.jpg` / `clip3-preview.mp4` | Preview clip 3 |
| `public/media/clip4-thumb.jpg` | Blurred teaser image for the locked 4th clip |

Keep preview clips short (a few seconds) and silent/looping — they're
meant as a teaser, not the full paid content. The 4th slot stays locked
on purpose; its thumbnail is shown blurred, so a lower-res/blurred image
works fine there too.

**Reminder:** everything in `public/` is publicly reachable by direct URL,
payment or not. Only put free-preview material here. Full paid content
belongs inside your Telegram group, never in this folder.

## Environment variables (set in Vercel → Project → Settings → Environment Variables)
| Variable | Example | Notes |
|---|---|---|
| `CASHFREE_APP_ID` | `TEST100...` | from your Cashfree dashboard |
| `CASHFREE_SECRET_KEY` | `cfsk_...` | **never commit this** |
| `CASHFREE_ENV` | `sandbox` or `production` | test with sandbox first |
| `SITE_URL` | `https://your-app.vercel.app` | your deployed domain |
| `TELEGRAM_INVITE_LINK` | `https://t.me/+xxxxxxxx` | keep this **out of git** |

Create a `.env.local` for local testing (already gitignored) — never
commit real keys or the Telegram link to GitHub.

## Recommended: use a one-time/limited-use Telegram invite link
Regenerate your Telegram invite link periodically (Telegram lets you set
member limits or expiry per link) so that even the server-held link stays
low-risk if it's ever rotated or leaked. This is standard practice for
paid Telegram communities regardless of payment processor.

## Deploying
```bash
git init
git add .
git commit -m "creator paywall"
# push to a GitHub repo, then import it in Vercel
# add the env vars above in Vercel before your first real payment test
```

Test fully in `CASHFREE_ENV=sandbox` with Cashfree's test cards before
switching to `production`.
