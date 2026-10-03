const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const router = require("../src/routes/legal");

let server, base;
before(async () => {
  const app = express();
  app.use(router);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test("privacy policy is public and carries Google's required Limited Use disclosure", async () => {
  process.env.LEGAL_CONTACT_EMAIL = "privacy@example.com";
  const res = await fetch(base + "/privacy");
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Google API Services User Data Policy/);
  assert.match(html, /Limited Use/);
  assert.match(html, /privacy@example\.com/);
});

test("terms of service are public", async () => {
  const res = await fetch(base + "/terms");
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Terms of Service/);
});
