const { test } = require("node:test");
const assert = require("node:assert/strict");
const { requireAdminAuth } = require("../src/middleware/adminAuth");

function mockRes() {
  const res = {};
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

test("rejects when ADMIN_SECRET is not configured", () => {
  delete process.env.ADMIN_SECRET;
  const req = { headers: {}, query: {} };
  const res = mockRes();
  let nextCalled = false;
  requireAdminAuth(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 500);
});

test("rejects a missing or wrong secret", () => {
  process.env.ADMIN_SECRET = "correct-secret";
  const req = { headers: {}, query: {} };
  const res = mockRes();
  let nextCalled = false;
  requireAdminAuth(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test("accepts the secret via X-Admin-Secret header", () => {
  process.env.ADMIN_SECRET = "correct-secret";
  const req = { headers: { "x-admin-secret": "correct-secret" }, query: {} };
  const res = mockRes();
  let nextCalled = false;
  requireAdminAuth(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test("accepts the secret via ?key= query param", () => {
  process.env.ADMIN_SECRET = "correct-secret";
  const req = { headers: {}, query: { key: "correct-secret" } };
  const res = mockRes();
  let nextCalled = false;
  requireAdminAuth(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});
