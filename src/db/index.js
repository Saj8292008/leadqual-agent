const { client, schema, addColumnIfMissing, prepare } = require("./client");

schema(`
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
    offered_slots TEXT,                      -- JSON [{start,end}] last emailed to the lead, so a numeric pick books exactly what they saw
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

// Databases created before the column existed.
addColumnIfMissing("leads", "offered_slots", "TEXT");

const statements = {
  insertLead: prepare(`
    INSERT INTO leads (source, name, email, status, notes)
    VALUES (@source, @name, @email, 'new', @notes)
  `),
  findLeadByEmail: prepare(`SELECT * FROM leads WHERE email = ? COLLATE NOCASE`),
  getLead: prepare(`SELECT * FROM leads WHERE id = ?`),
  listLeads: prepare(`SELECT * FROM leads ORDER BY updated_at DESC`),
  messageByMessageId: prepare(`SELECT * FROM messages WHERE message_id = ?`),
  updateLead: prepare(`
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
  insertMessage: prepare(`
    INSERT INTO messages (lead_id, direction, channel, subject, body, message_id)
    VALUES (@lead_id, @direction, @channel, @subject, @body, @message_id)
  `),
  historyForLead: prepare(`
    SELECT direction, channel, subject, body, message_id, created_at FROM messages
    WHERE lead_id = ? ORDER BY created_at ASC
  `),
  setOfferedSlots: prepare(`UPDATE leads SET offered_slots = @offered_slots WHERE id = @id`),
  leadsDueForDrip: prepare(`
    SELECT * FROM leads
    WHERE status = 'nurture' AND datetime(next_followup_at) <= datetime('now')
  `),
};

module.exports = { client, statements };
