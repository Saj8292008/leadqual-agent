const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "leadqual-test-"));
process.env.ADMIN_SECRET = "crm-test-secret-123";
process.env.AGENT_NAME = "John Wallace";

const express = require("express");
const { statements } = require("../src/db");
const claude = require("../src/services/claude");
const email = require("../src/services/email");
const router = require("../src/routes/crm");

let server, base, cookie;
before(async () => {
  const app = express();
  app.use(router);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/crm/login?key=crm-test-secret-123`, { redirect: "manual" });
  cookie = login.headers.get("set-cookie").split(";")[0];
});
after(() => server.close());

let sent;
beforeEach(() => {
  sent = [];
  claude.converse = async () => ({ reply: "Hi! What's your budget?", status: "qualifying" });
  email.sendEmail = async (a) => (sent.push(a), { messageId: null });
});

const get = (p, c = cookie) => fetch(base + p, { headers: c ? { cookie: c } : {}, redirect: "manual" });
const post = (p, body, headers = {}) =>
  fetch(base + p, {
    method: "POST",
    redirect: "manual",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(body).toString(),
  });

async function addLead(fields) {
  const { lastInsertRowid: id } = await statements.insertLead.run({ source: "website", name: null, email: null, notes: null, ...fields });
  return id;
}

test("signing in needs the full key, sets a session cookie, and keeps the key out of the URL", async () => {
  assert.equal((await get("/crm", null)).status, 401);
  assert.equal((await fetch(`${base}/crm/login?key=crm-test-secret`, { redirect: "manual" })).status, 401, "truncated key");
  const login = await fetch(`${base}/crm/login?key=crm-test-secret-123%60`, { redirect: "manual" });
  assert.equal(login.status, 303, "stray pasted characters tolerated");
  assert.equal(login.headers.get("location"), "/crm");
  assert.match(login.headers.get("set-cookie"), /HttpOnly; SameSite=Lax/);
  assert.equal((await get("/crm", "crm_session=forged")).status, 401);
  assert.equal((await get("/crm")).status, 200);
});

test("the pipeline groups leads by stage, with 'Needs you' first", async () => {
  const a = await addLead({ name: "Talking Tina", email: "tina@example.com" });
  const b = await addLead({ name: "Handoff Hank", email: "hank@example.com" });
  await statements.setStatus.run({ id: b, status: "handoff" });
  const html = await (await get("/crm")).text();
  assert.ok(html.indexOf("Needs you") < html.indexOf("Sam is talking"));
  assert.ok(html.indexOf("Handoff Hank") < html.indexOf("Talking Tina"));
  assert.match(html, /John Wallace(&#39;|')s leads/);
  assert.ok(a);
});

test("lead text is escaped — a lead can't inject markup into the agent's CRM", async () => {
  const id = await addLead({ name: '<img src=x onerror="alert(1)">', email: "xss@example.com", notes: "<script>steal()</script>" });
  await statements.insertMessage.run({ lead_id: id, direction: "inbound", channel: "email", subject: null, body: "<script>alert('x')</script>", message_id: null });
  for (const p of ["/crm", `/crm/leads/${id}`]) {
    const html = await (await get(p)).text();
    assert.doesNotMatch(html, /<script>|<img src=x/, p);
    assert.match(html, /&lt;script&gt;|&lt;img/, p);
  }
});

test("take over, hand back, close, and notes", async () => {
  const id = await addLead({ name: "Action Al", email: "al@example.com" });
  assert.equal((await post(`/crm/leads/${id}/take-over`, {})).status, 303);
  assert.equal((await statements.getLead.get(id)).status, "handoff");
  assert.match(await (await get(`/crm/leads/${id}`)).text(), /You're handling this lead/);

  await post(`/crm/leads/${id}/hand-back`, {});
  assert.equal((await statements.getLead.get(id)).status, "qualifying");

  await post(`/crm/leads/${id}/notes`, { note: "Called him, wants Saturday" });
  await post(`/crm/leads/${id}/notes`, { note: "Pre-approved with Chase" });
  const notes = (await statements.getLead.get(id)).agent_notes;
  assert.match(notes, /Called him, wants Saturday[\s\S]*Pre-approved with Chase/);

  await post(`/crm/leads/${id}/close`, {});
  assert.equal((await statements.getLead.get(id)).status, "dead");
});

test("an unsubscribed lead can't be handed back to Sam", async () => {
  const id = await addLead({ name: "Opted Olive", email: "olive@example.com" });
  await statements.markOptedOut.run({ id });
  await post(`/crm/leads/${id}/hand-back`, {});
  assert.equal((await statements.getLead.get(id)).status, "dead");
  assert.doesNotMatch(await (await get(`/crm/leads/${id}`)).text(), /hand-back/);
});

test("adding a lead by hand: Sam emails them, or stays out of it if unticked", async () => {
  let res = await post("/crm/leads", { name: "Referral Rita", email: "rita@example.com", phone: "404-555-0100", source: "Referral", notes: "From Mike", reach_out: "1" });
  assert.equal(res.status, 303);
  const rita = await statements.findLeadByEmail.get("rita@example.com");
  assert.equal(rita.phone, "404-555-0100");
  assert.equal(rita.source, "referral");
  for (let i = 0; i < 50 && !sent.length; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "rita@example.com");

  res = await post("/crm/leads", { email: "quiet@example.com", source: "Phone call" });
  const quiet = await statements.findLeadByEmail.get("quiet@example.com");
  assert.equal(quiet.status, "handoff");
  assert.equal(sent.length, 1, "no email when unticked");

  res = await post("/crm/leads", { email: "rita@example.com", reach_out: "1" });
  assert.equal(res.status, 409);
  assert.match(await res.text(), /already a lead/);
  res = await post("/crm/leads", { email: "not-an-email" });
  assert.equal(res.status, 400);
});

test("posts from another site are refused", async () => {
  const id = await addLead({ name: "Csrf Carl", email: "carl@example.com" });
  const res = await post(`/crm/leads/${id}/close`, {}, { origin: "https://evil.example.com" });
  assert.equal(res.status, 403);
  assert.notEqual((await statements.getLead.get(id)).status, "dead");
});
