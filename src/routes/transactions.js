const express = require("express");
const { isValidWebhookSecret } = require("../middleware/webhookAuth");
const { transactionStatements, createTransactionWithMilestones } = require("../db/transactions");
const { requireAdminAuth } = require("../middleware/adminAuth");

const router = express.Router();

// Intake for an accepted offer — call this the moment a deal goes under
// contract. Any of the deadline fields left blank simply won't get a
// tracked milestone (e.g. a cash deal might skip financing).
router.post("/webhooks/transaction", async (req, res) => {
  if (!isValidWebhookSecret(req)) {
    return res.status(401).json({ error: "bad secret" });
  }

  const {
    address, buyer_name, buyer_email, seller_name, seller_email,
    contract_date, inspection_deadline, financing_deadline, appraisal_deadline, closing_date, notes,
  } = req.body;

  if (!address) return res.status(400).json({ error: "address is required" });
  if (!closing_date) return res.status(400).json({ error: "closing_date is required" });

  const id = await createTransactionWithMilestones({
    address,
    buyer_name: buyer_name || null,
    buyer_email: buyer_email || null,
    seller_name: seller_name || null,
    seller_email: seller_email || null,
    contract_date: contract_date || null,
    inspection_deadline: inspection_deadline || null,
    financing_deadline: financing_deadline || null,
    appraisal_deadline: appraisal_deadline || null,
    closing_date,
    notes: notes || null,
  });

  res.status(201).json({ id });
});

router.get("/transactions", requireAdminAuth, async (req, res) => {
  res.json(await transactionStatements.listTransactions.all());
});

router.get("/transactions/:id", requireAdminAuth, async (req, res) => {
  const transaction = await transactionStatements.getTransaction.get(req.params.id);
  if (!transaction) return res.status(404).json({ error: "not found" });
  res.json({
    ...transaction,
    milestones: await transactionStatements.milestonesForTransaction.all(transaction.id),
  });
});

router.post("/transactions/:id/milestones/:milestoneId/complete", requireAdminAuth, async (req, res) => {
  const transaction = await transactionStatements.getTransaction.get(req.params.id);
  if (!transaction) return res.status(404).json({ error: "not found" });
  await transactionStatements.markMilestoneComplete.run(req.params.milestoneId);
  res.json(await transactionStatements.milestonesForTransaction.all(transaction.id));
});

router.post("/transactions/:id/status", requireAdminAuth, async (req, res) => {
  const transaction = await transactionStatements.getTransaction.get(req.params.id);
  if (!transaction) return res.status(404).json({ error: "not found" });
  const { status } = req.body;
  if (!["active", "closed", "fell_through"].includes(status)) {
    return res.status(400).json({ error: "status must be active, closed, or fell_through" });
  }
  await transactionStatements.markStatus.run({ id: transaction.id, status });
  res.json(await transactionStatements.getTransaction.get(transaction.id));
});

module.exports = router;
