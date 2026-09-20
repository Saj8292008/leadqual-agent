const express = require("express");
const { statements } = require("../db");

const router = express.Router();

// Read-only visibility into the pipeline — no dashboard yet, so this is the
// way to watch leads move through qualification without opening the sqlite file.
router.get("/leads", (req, res) => {
  res.json(statements.listLeads.all());
});

router.get("/leads/:id", (req, res) => {
  const lead = statements.getLead.get(req.params.id);
  if (!lead) return res.status(404).json({ error: "not found" });
  res.json({ ...lead, messages: statements.historyForLead.all(lead.id) });
});

module.exports = router;
