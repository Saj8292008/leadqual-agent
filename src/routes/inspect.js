const express = require("express");
const { statements } = require("../db");
const { requireAdminAuth } = require("../middleware/adminAuth");

const router = express.Router();

// Read-only visibility into the pipeline — no dashboard yet, so this is the
// way to watch leads move through qualification without opening the sqlite file.
// Gated: this returns lead PII (names, emails, full conversation history).
router.get("/leads", requireAdminAuth, async (req, res) => {
  res.json(await statements.listLeads.all());
});

router.get("/leads/:id", requireAdminAuth, async (req, res) => {
  const lead = await statements.getLead.get(req.params.id);
  if (!lead) return res.status(404).json({ error: "not found" });
  res.json({ ...lead, messages: await statements.historyForLead.all(lead.id) });
});

module.exports = router;
