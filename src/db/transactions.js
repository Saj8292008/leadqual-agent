const { schema, prepare, transaction } = require("./client");

schema(`
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
  getTransaction: prepare(`SELECT * FROM transactions WHERE id = ?`),
  listTransactions: prepare(`SELECT * FROM transactions ORDER BY updated_at DESC`),
  milestonesForTransaction: prepare(`
    SELECT * FROM transaction_milestones WHERE transaction_id = ? ORDER BY due_date ASC
  `),
  markMilestoneComplete: prepare(`
    UPDATE transaction_milestones SET completed_at = datetime('now') WHERE id = ?
  `),
  markStatus: prepare(`
    UPDATE transactions SET status = @status, updated_at = datetime('now') WHERE id = @id
  `),
  // Pending (not completed) milestones due within the given days that haven't been reminded yet today.
  // due_date is the agent's local calendar date, so @today is passed in as the agent's local date
  // (see lib/time.js) — the database's own date('now') is UTC, and 'localtime' on a hosted DB is UTC too,
  // which would flag a deadline as overdue in the evening while it's still "due today" locally.
  // last_reminder_sent_at stores that same local date.
  milestonesNeedingReminder: prepare(`
    SELECT m.*, t.address, t.buyer_email, t.seller_email FROM transaction_milestones m
    JOIN transactions t ON t.id = m.transaction_id
    WHERE m.completed_at IS NULL
      AND t.status = 'active'
      AND date(m.due_date) <= date(@today, '+' || @days || ' days')
      AND (m.last_reminder_sent_at IS NULL OR date(m.last_reminder_sent_at) < @today)
  `),
  milestonesOverdue: prepare(`
    SELECT m.*, t.address FROM transaction_milestones m
    JOIN transactions t ON t.id = m.transaction_id
    WHERE m.completed_at IS NULL
      AND t.status = 'active'
      AND date(m.due_date) < @today
      AND m.missed_alert_sent_at IS NULL
  `),
  markReminderSent: prepare(`
    UPDATE transaction_milestones SET last_reminder_sent_at = @today WHERE id = @id
  `),
  markMissedAlertSent: prepare(`
    UPDATE transaction_milestones SET missed_alert_sent_at = datetime('now') WHERE id = ?
  `),
};

const INSERT_TRANSACTION_SQL = `
  INSERT INTO transactions (
    address, buyer_name, buyer_email, seller_name, seller_email,
    contract_date, inspection_deadline, financing_deadline, appraisal_deadline, closing_date, notes
  ) VALUES (
    @address, @buyer_name, @buyer_email, @seller_name, @seller_email,
    @contract_date, @inspection_deadline, @financing_deadline, @appraisal_deadline, @closing_date, @notes
  )`;
const INSERT_MILESTONE_SQL = `
  INSERT INTO transaction_milestones (transaction_id, name, due_date)
  VALUES (@transaction_id, @name, @due_date)`;

// All-or-nothing, so a transaction never exists without its deadlines.
async function createTransactionWithMilestones(fields) {
  return transaction(async (tx) => {
    const { lastInsertRowid: transactionId } = await tx.run(INSERT_TRANSACTION_SQL, fields);
    for (const { name, column } of MILESTONE_FIELDS) {
      if (fields[column]) {
        await tx.run(INSERT_MILESTONE_SQL, { transaction_id: transactionId, name, due_date: fields[column] });
      }
    }
    return transactionId;
  });
}

module.exports = { transactionStatements, createTransactionWithMilestones, MILESTONE_FIELDS };
