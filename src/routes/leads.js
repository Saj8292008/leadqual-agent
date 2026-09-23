const express = require("express");
const { isValidWebhookSecret } = require("../middleware/webhookAuth");
const { statements } = require("../db");
const { runTurn } = require("../services/conversationEngine");

const router = express.Router();

// Generic intake endpoint. Point Zillow Premier Agent lead export, a website
// form, or a Zapier/Facebook Lead Ads webhook here. Normalize their payload
// shape to { source, name, phone, email, notes } before forwarding, or add
// a source-specific adapter below if the payload needs field mapping.
router.post("/webhooks/lead", async (req, res) => {
  if (!isValidWebhookSecret(req)) {
    return res.status(401).json({ error: "bad secret" });
  }

  const { source, name, email, notes } = req.body;
  if (!email) return res.status(400).json({ error: "email is required" });

  const existing = statements.findLeadByEmail.get(email);
  if (existing) {
    return res.status(200).json({ id: existing.id, status: "already exists" });
  }

  const info = statements.insertLead.run({
    source: source || "unknown",
    name: name || null,
    email,
    notes: notes || null,
  });

  res.status(201).json({ id: info.lastInsertRowid });

  // First outbound touch — fire and forget so the webhook responds fast.
  runTurn(info.lastInsertRowid).catch((err) =>
    console.error(`[lead ${info.lastInsertRowid}] first-touch failed:`, err)
  );
});

module.exports = router;
