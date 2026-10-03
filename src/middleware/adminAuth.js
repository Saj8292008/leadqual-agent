// Gates read/write access to internal inspection and listing-management
// routes. Accepts the secret via header (for API/CLI use) or a `key` query
// param (so a flyer link can still be opened directly in a browser).
function requireAdminAuth(req, res, next) {
  const raw = req.headers["x-admin-secret"] || req.query.key;
  // Links get pasted from chat/terminals and pick up stray trailing characters
  // (observed: 3 extra chars after a correct key). Keys are hex, so anything
  // outside [A-Za-z0-9_-] can't be part of one — drop it before comparing.
  const provided = typeof raw === "string" ? raw.replace(/[^A-Za-z0-9_-]/g, "") : raw;
  if (!process.env.ADMIN_SECRET) {
    return res.status(500).json({ error: "ADMIN_SECRET is not configured" });
  }
  if (provided !== process.env.ADMIN_SECRET) {
    // Never logs the key — just enough to tell a mangled link from a wrong one.
    console.warn(
      `[admin-auth] rejected ${req.method} ${req.path}: ` +
        (raw === undefined ? "no key" : `key length ${String(raw).length} (expected ${process.env.ADMIN_SECRET.length})`)
    );
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

module.exports = { requireAdminAuth };
