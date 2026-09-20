const path = require("path");
const Database = require("better-sqlite3");

const db = new Database(path.join(__dirname, "..", "..", "data.sqlite"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    name TEXT,
    email TEXT,
    status TEXT NOT NULL DEFAULT 'new',      -- new | qualifying | nurture | booked | handoff | dead
    budget TEXT,
    timeline TEXT,
    motivation TEXT,
    notes TEXT,
    thread_id TEXT,
    next_followup_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL REFERENCES leads(id),
    direction TEXT NOT NULL,                 -- inbound | outbound
    channel TEXT NOT NULL DEFAULT 'email',
    subject TEXT,
    body TEXT NOT NULL,
    message_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
  CREATE INDEX IF NOT EXISTS idx_messages_lead ON messages(lead_id);
  -- SQLite unique indexes ignore NULLs, so dry-run sends (message_id = null) are unaffected.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_message_id ON messages(message_id);
`);

const statements = {
  insertLead: db.prepare(`
    INSERT INTO leads (source, name, email, status, notes)
    VALUES (@source, @name, @email, 'new', @notes)
  `),
  findLeadByEmail: db.prepare(`SELECT * FROM leads WHERE email = ?`),
  getLead: db.prepare(`SELECT * FROM leads WHERE id = ?`),
  listLeads: db.prepare(`SELECT * FROM leads ORDER BY updated_at DESC`),
  messageByMessageId: db.prepare(`SELECT * FROM messages WHERE message_id = ?`),
  updateLead: db.prepare(`
    UPDATE leads SET
      status = @status,
      budget = @budget,
      timeline = @timeline,
      motivation = @motivation,
      notes = @notes,
      thread_id = @thread_id,
      next_followup_at = @next_followup_at,
      updated_at = datetime('now')
    WHERE id = @id
  `),
  insertMessage: db.prepare(`
    INSERT INTO messages (lead_id, direction, channel, subject, body, message_id)
    VALUES (@lead_id, @direction, @channel, @subject, @body, @message_id)
  `),
  historyForLead: db.prepare(`
    SELECT direction, channel, subject, body, message_id, created_at FROM messages
    WHERE lead_id = ? ORDER BY created_at ASC
  `),
  leadsDueForDrip: db.prepare(`
    SELECT * FROM leads
    WHERE status = 'nurture' AND next_followup_at <= datetime('now')
  `),
};

module.exports = { db, statements };
