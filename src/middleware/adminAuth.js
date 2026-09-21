// Gates read/write access to internal inspection and listing-management
// routes. Accepts the secret via header (for API/CLI use) or a `key` query
// param (so a flyer link can still be opened directly in a browser).
function requireAdminAuth(req, res, next) {
  const provided = req.headers["x-admin-secret"] || req.query.key;
  if (!process.env.ADMIN_SECRET) {
    return res.status(500).json({ error: "ADMIN_SECRET is not configured" });
  }
  if (provided !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

module.exports = { requireAdminAuth };
