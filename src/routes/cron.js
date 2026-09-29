const crypto = require("crypto");
const express = require("express");
const drip = require("../services/dripRunner");
const transactionReminders = require("../services/transactionReminderRunner");
const propertyReminders = require("../services/propertyReminderRunner");

const router = express.Router();

// Vercel Cron calls these with "Authorization: Bearer <CRON_SECRET>".
// Fails closed when CRON_SECRET isn't set, like the other webhooks.
function isValidCronRequest(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(req.headers.authorization || "");
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}

const JOBS = {
  drip: drip.main,
  "transaction-reminders": transactionReminders.main,
  "property-reminders": propertyReminders.main,
};

router.get("/cron/:job", async (req, res) => {
  if (!isValidCronRequest(req)) return res.status(401).json({ error: "unauthorized" });
  const job = JOBS[req.params.job];
  if (!job) return res.status(404).json({ error: "unknown job" });
  // Runs to completion before responding — the function stays alive for the
  // whole job, and Vercel's cron log shows whether it succeeded.
  await job();
  res.json({ ok: true, job: req.params.job });
});

module.exports = router;
module.exports.isValidCronRequest = isValidCronRequest;
