const { db } = require("./index");

// Small key/value store for per-install configuration the agent sets through
// the app itself (e.g. their connected Google Calendar), rather than .env.
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const getStmt = db.prepare(`SELECT value FROM settings WHERE key = ?`);
const setStmt = db.prepare(`
  INSERT INTO settings (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
`);
const deleteStmt = db.prepare(`DELETE FROM settings WHERE key = ?`);

function getSetting(key) {
  const row = getStmt.get(key);
  return row ? JSON.parse(row.value) : null;
}

function setSetting(key, value) {
  setStmt.run(key, JSON.stringify(value));
}

function deleteSetting(key) {
  deleteStmt.run(key);
}

module.exports = { getSetting, setSetting, deleteSetting };
