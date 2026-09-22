const { db } = require("./index");

db.exec(`
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT NOT NULL,
    buyer_name TEXT,
    buyer_email TEXT,
    seller_name TEXT,
    seller_email TEXT,
    contract_date TEXT,
    inspection_deadline TEXT,
    financing_deadline TEXT,
    appraisal_deadline TEXT,
    closing_date TEXT,
    status TEXT NOT NULL DEFAULT 'active',  -- active | closed | fell_through
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS transaction_milestones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id INTEGER NOT NULL REFERENCES transactions(id),
    name TEXT NOT NULL,          -- inspection | financing | appraisal | closing
    due_date TEXT NOT NULL,
    completed_at TEXT,
    last_reminder_sent_at TEXT,
    missed_alert_sent_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_milestones_transaction ON transaction_milestones(transaction_id);
`);

const MILESTONE_FIELDS = [
  { name: "inspection", column: "inspection_deadline" },
  { name: "financing", column: "financing_deadline" },
  { name: "appraisal", column: "appraisal_deadline" },
  { name: "closing", column: "closing_date" },
];

const transactionStatements = {
  insertTransaction: db.prepare(`
    INSERT INTO transactions (
      address, buyer_name, buyer_email, seller_name, seller_email,
      contract_date, inspection_deadline, financing_deadline, appraisal_deadline, closing_date, notes
    ) VALUES (
      @address, @buyer_name, @buyer_email, @seller_name, @seller_email,
      @contract_date, @inspection_deadline, @financing_deadline, @appraisal_deadline, @closing_date, @notes
    )
  `),
  insertMilestone: db.prepare(`
    INSERT INTO transaction_milestones (transaction_id, name, due_date)
    VALUES (@transaction_id, @name, @due_date)
  `),
  getTransaction: db.prepare(`SELECT * FROM transactions WHERE id = ?`),
  listTransactions: db.prepare(`SELECT * FROM transactions ORDER BY updated_at DESC`),
  milestonesForTransaction: db.prepare(`
    SELECT * FROM transaction_milestones WHERE transaction_id = ? ORDER BY due_date ASC
  `),
  markMilestoneComplete: db.prepare(`
    UPDATE transaction_milestones SET completed_at = datetime('now') WHERE id = ?
  `),
  markStatus: db.prepare(`
    UPDATE transactions SET status = @status, updated_at = datetime('now') WHERE id = @id
  `),
  // Pending (not completed) milestones due within the given days, that haven't been reminded yet today.
  milestonesNeedingReminder: db.prepare(`
    SELECT m.*, t.address, t.buyer_email, t.seller_email FROM transaction_milestones m
    JOIN transactions t ON t.id = m.transaction_id
    WHERE m.completed_at IS NULL
      AND t.status = 'active'
      AND date(m.due_date) <= date('now', '+' || ? || ' days')
      AND (m.last_reminder_sent_at IS NULL OR date(m.last_reminder_sent_at) < date('now'))
  `),
  milestonesOverdue: db.prepare(`
    SELECT m.*, t.address FROM transaction_milestones m
    JOIN transactions t ON t.id = m.transaction_id
    WHERE m.completed_at IS NULL
      AND t.status = 'active'
      AND date(m.due_date) < date('now')
      AND m.missed_alert_sent_at IS NULL
  `),
  markReminderSent: db.prepare(`
    UPDATE transaction_milestones SET last_reminder_sent_at = datetime('now') WHERE id = ?
  `),
  markMissedAlertSent: db.prepare(`
    UPDATE transaction_milestones SET missed_alert_sent_at = datetime('now') WHERE id = ?
  `),
};

function createTransactionWithMilestones(fields) {
  const info = transactionStatements.insertTransaction.run(fields);
  const transactionId = info.lastInsertRowid;
  for (const { name, column } of MILESTONE_FIELDS) {
    if (fields[column]) {
      transactionStatements.insertMilestone.run({
        transaction_id: transactionId,
        name,
        due_date: fields[column],
      });
    }
  }
  return transactionId;
}

module.exports = { transactionStatements, createTransactionWithMilestones, MILESTONE_FIELDS };
