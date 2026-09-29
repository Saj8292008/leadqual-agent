const { schema, prepare } = require("./client");

// Small key/value store for per-install configuration the agent sets through
// the app itself (e.g. their connected Google Calendar), rather than .env.
schema(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const getStmt = prepare(`SELECT value FROM settings WHERE key = ?`);
const setStmt = prepare(`
  INSERT INTO settings (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
`);
const deleteStmt = prepare(`DELETE FROM settings WHERE key = ?`);

async function getSetting(key) {
  const row = await getStmt.get(key);
  return row ? JSON.parse(row.value) : null;
}

async function setSetting(key, value) {
  await setStmt.run(key, JSON.stringify(value));
}

async function deleteSetting(key) {
  await deleteStmt.run(key);
}

module.exports = { getSetting, setSetting, deleteSetting };
