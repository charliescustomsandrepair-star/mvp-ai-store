# MVP AI Store — Deployable repo (one-click deploy guidance)

This repo provides a minimal legal MVP: a simple store where customers pay (Stripe Checkout). When payment is confirmed the backend automatically uses OpenAI to generate a deliverable (article) and creates a PDF the buyer can download. You own payouts via Stripe.

> ⚠️ This is an MVP. In production you should add authentication, database persistence, HTTPS config (Render provides TLS), and payment/webhook verification.

## Files
- `server.js` — Express server with endpoints
- `public/index.html` — storefront
- `public/success.html` — checkout success & finalize step
- `.env.template` — environment variables you must set
- `package.json` — dependencies

## Required environment variables
Create a `.env` file (copy `.env.template`) and fill values:
