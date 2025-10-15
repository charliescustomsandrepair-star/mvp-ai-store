// server.js
// Minimal MVP: Express server that serves a product page, creates Stripe Checkout sessions,
// on success generates content via OpenAI and returns a downloadable PDF.

const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const fs = require("fs");
const { Configuration, OpenAIApi } = require("openai");
const Stripe = require("stripe");
const PDFDocument = require("pdfkit");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();

const PORT = process.env.PORT || 3333;
const DOMAIN = process.env.DOMAIN || `http://localhost:${PORT}`; // Used for redirect URLs

if (!process.env.OPENAI_API_KEY) {
  console.warn("Warning: OPENAI_API_KEY not set in env. Some features won't run without it.");
}
if (!process.env.STRIPE_SECRET_KEY) {
  console.warn("Warning: STRIPE_SECRET_KEY not set in env. Stripe checkout won't work without it.");
}

const openai = new OpenAIApi(new Configuration({
  apiKey: process.env.OPENAI_API_KEY
}));

const stripe = Stripe(process.env.STRIPE_SECRET_KEY || "");

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// In-memory store (for MVP). In production use a DB.
const ORDERS = {}; // orderId -> { id, status, email, productId, downloadPath, createdAt }

app.get("/healthz", (req, res) => res.send({ ok: true }));

// Create Stripe checkout session
app.post("/create-checkout-session", async (req, res) => {
  try {
    const { productId, buyerEmail } = req.body;
    // For MVP we have single product
    const product = {
      id: "ultimate-mega-bundle",
      name: "Ultimate Digital Bundle (Planner + Templates + Guides)",
      description: "Instant-download digital business & lifestyle bundle.",
      amount_cents: 1999, // $19.99
      currency: "usd"
    };

    const orderId = uuidv4();
    ORDERS[orderId] = {
      id: orderId,
      status: "pending_payment",
      email: buyerEmail || null,
      productId: product.id,
      createdAt: new Date().toISOString()
    };

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: product.currency,
          product_data: {
            name: product.name,
            description: product.description
          },
          unit_amount: product.amount_cents
        },
        quantity: 1
      }],
      mode: "payment",
      success_url: `${DOMAIN}/success.html?session_id={CHECKOUT_SESSION_ID}&orderId=${orderId}`,
      cancel_url: `${DOMAIN}/`
    });

    // Save mapping from session to order (simple)
    ORDERS[orderId].stripeSessionId = session.id;

    res.json({ url: session.url });
  } catch (err) {
    console.error("create-checkout-session error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// After checkout success redirect, frontend hits this endpoint to finalize order
app.get("/finalize-order", async (req, res) => {
  try {
    const { session_id, orderId } = req.query;
    if (!orderId || !ORDERS[orderId]) {
      return res.status(400).json({ error: "missing or invalid orderId" });
    }
    // Retrieve session to confirm payment
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (!session || session.payment_status !== "paid") {
      ORDERS[orderId].status = "payment_failed";
      return res.status(400).json({ error: "payment not confirmed" });
    }

    ORDERS[orderId].status = "paid";
    ORDERS[orderId].email = ORDERS[orderId].email || session.customer_details?.email || null;

    // Generate deliverable using OpenAI
    const prompt = `Create a high-quality 800-word article titled "Quick Productivity Systems" with headings, intro, conclusion, and a 1-line meta description. Keep it friendly and actionable.`;

    let generatedText = "Generated content not available.";
    try {
      const gresp = await openai.createChatCompletion({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a helpful assistant that writes articles." },
          { role: "user", content: prompt }
        ],
        max_tokens: 900,
        temperature: 0.2
      });
      generatedText = gresp.data.choices[0].message.content;
    } catch (gerr) {
      console.error("OpenAI error:", gerr);
      generatedText = "Error generating content with OpenAI.";
    }

    // Create PDF
    const downloadsDir = path.join(__dirname, "public", "downloads");
    if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });

    const filename = `bundle-${orderId}.pdf`;
    const filepath = path.join(downloadsDir, filename);

    await new Promise((resolve, reject) => {
      const doc = new PDFDocument();
      const stream = fs.createWriteStream(filepath);
      doc.pipe(stream);
      doc.fontSize(20).text("Ultimate Digital Bundle — Deliverable", { underline: true });
      doc.moveDown();
      doc.fontSize(12).text(`Order ID: ${orderId}`);
      doc.moveDown();
      doc.fontSize(14).text(generatedText || "No content");
      doc.end();
      stream.on("finish", resolve);
      stream.on("error", reject);
    });

    ORDERS[orderId].status = "completed";
    ORDERS[orderId].downloadPath = `/downloads/${filename}`;

    // Respond with download link
    res.json({
      ok: true,
      orderId,
      downloadUrl: `${DOMAIN}${ORDERS[orderId].downloadPath}`
    });
  } catch (err) {
    console.error("finalize-order error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// Admin list orders (basic)
app.get("/admin/orders", (req, res) => {
  // NOTE: No auth in MVP. When deploying protect this endpoint.
  res.json(Object.values(ORDERS));
});

// Serve index (frontend in /public)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`MVP AI store running on port ${PORT}. DOMAIN=${DOMAIN}`);
});
