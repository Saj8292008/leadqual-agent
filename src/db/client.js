const path = require("path");
const { createClient } = require("@libsql/client");

// Turso (hosted libSQL) in production — serverless hosts like Vercel have no
// persistent disk. Locally and in tests, the same client talks to a plain
// SQLite file, so the SQL is identical in both places.
// DATA_DIR picks the local file's folder (tests point it at a temp dir).
const url =
  process.env.TURSO_DATABASE_URL ||
  `file:${path.join(process.env.DATA_DIR || path.join(__dirname, "..", ".."), "data.sqlite")}`;
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

// Each db module registers its CREATE TABLE statements here; every query
// waits until all schema registered so far has been applied.
let ready = Promise.resolve();
function schema(sql) {
  ready = ready.then(() => client.executeMultiple(sql));
}

// For columns added after a table first shipped: CREATE TABLE IF NOT EXISTS
// won't touch an existing table, so add the column when it's absent.
function addColumnIfMissing(table, column, type) {
  ready = ready.then(async () => {
    const { rows } = await client.execute(`PRAGMA table_info(${table})`);
    if (!rows.some((r) => r.name === column)) {
      await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  });
}

function toArgs(params) {
  if (params.length === 1 && params[0] !== null && typeof params[0] === "object") return params[0];
  return params;
}

function plainRow(result, row) {
  return Object.fromEntries(result.columns.map((col, i) => [col, row[i]]));
}

// Same shape as better-sqlite3's prepared statements (get/all/run, positional
// or @named params), but async — callers `await` each call.
function prepare(sql) {
  const execute = async (params) => {
    await ready;
    return client.execute({ sql, args: toArgs(params) });
  };
  return {
    async get(...params) {
      const result = await execute(params);
      return result.rows.length ? plainRow(result, result.rows[0]) : undefined;
    },
    async all(...params) {
      const result = await execute(params);
      return result.rows.map((row) => plainRow(result, row));
    },
    async run(...params) {
      const result = await execute(params);
      return {
        changes: result.rowsAffected,
        lastInsertRowid: result.lastInsertRowid === undefined ? undefined : Number(result.lastInsertRowid),
      };
    },
  };
}

// Runs fn(tx) inside a write transaction; tx.run/get take (sql, params).
async function transaction(fn) {
  await ready;
  const tx = await client.transaction("write");
  try {
    const wrapped = {
      async run(sql, params) {
        const result = await tx.execute({ sql, args: params });
        return { changes: result.rowsAffected, lastInsertRowid: Number(result.lastInsertRowid) };
      },
    };
    const value = await fn(wrapped);
    await tx.commit();
    return value;
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  } finally {
    tx.close();
  }
}

module.exports = { client, schema, addColumnIfMissing, prepare, transaction, ready: () => ready };
