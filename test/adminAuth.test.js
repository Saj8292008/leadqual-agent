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

test("tolerates stray characters pasted onto the end of a key link", () => {
  // Regression: a connect link copied from chat arrived with 3 extra
  // characters after the correct key and was rejected.
  process.env.ADMIN_SECRET = "abc123def456";
  let passed = false;
  const res = { status: () => ({ json: () => {} }) };
  requireAdminAuth({ headers: {}, query: { key: "abc123def456`​ " } }, res, () => (passed = true));
  assert.equal(passed, true);

  passed = false;
  requireAdminAuth({ headers: {}, query: { key: "abc123def45" } }, res, () => (passed = true));
  assert.equal(passed, false, "a shorter, wrong key still fails");
  delete process.env.ADMIN_SECRET;
});
