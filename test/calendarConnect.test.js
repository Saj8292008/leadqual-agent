const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Isolated DB for this test file (node --test runs each file in its own process).
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "leadqual-test-"));
process.env.ADMIN_SECRET = "admin-test";
process.env.GOOGLE_OAUTH_CLIENT_ID = "client-id.apps.googleusercontent.com";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "client-secret";
process.env.PUBLIC_BASE_URL = "https://agent.example.com";

const express = require("express");
const calendar = require("../src/services/calendar");
const { getSetting } = require("../src/db/settings");
const router = require("../src/routes/calendarConnect");

let server;
let base;
before(async () => {
  const app = express();
  app.use(router);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const get = (p) => fetch(base + p, { redirect: "manual" });

// A Google ID token only needs a readable payload here — see the route's note.
const fakeIdToken = (email) =>
  ["h", Buffer.from(JSON.stringify({ email })).toString("base64url"), "s"].join(".");

function stubTokenExchange(tokens) {
  const original = calendar.oauthClient;
  calendar.oauthClient = () => {
    const client = original();
    client.getToken = async () => ({ tokens });
    return client;
  };
  return () => (calendar.oauthClient = original);
}

async function startConnect() {
  const res = await get("/connect/calendar?key=admin-test");
  assert.equal(res.status, 302);
  return new URL(res.headers.get("location"));
}

test("the connect link requires the admin key", async () => {
  assert.equal((await get("/connect/calendar")).status, 401);
  assert.equal((await get("/connect/calendar?key=wrong")).status, 401);
});

test("the connect link sends the agent to Google asking for offline calendar access", async () => {
  const url = await startConnect();
  assert.equal(url.host, "accounts.google.com");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("redirect_uri"), "https://agent.example.com/connect/calendar/callback");
  assert.match(url.searchParams.get("scope"), /calendar\.events/);
  assert.match(url.searchParams.get("scope"), /calendar\.freebusy/);
  assert.ok(url.searchParams.get("state"));
});

test("a callback with a forged state is rejected and connects nothing", async () => {
  await startConnect();
  const restore = stubTokenExchange({ refresh_token: "attacker-token" });
  try {
    const res = await get("/connect/calendar/callback?code=abc&state=forged");
    assert.equal(res.status, 400);
  } finally {
    restore();
  }
  assert.equal(await getSetting(calendar.CALENDAR_CONNECTION_KEY), null);
});

test("a valid callback stores the connection and calendar calls switch to the agent's own calendar", async () => {
  const state = (await startConnect()).searchParams.get("state");
  const restore = stubTokenExchange({ refresh_token: "refresh-123", id_token: fakeIdToken("agent@gmail.com") });
  try {
    const res = await get(`/connect/calendar/callback?code=abc&state=${state}`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /agent@gmail\.com/);

    // State is single-use: replaying the same redirect fails.
    assert.equal((await get(`/connect/calendar/callback?code=abc&state=${state}`)).status, 400);
  } finally {
    restore();
  }

  const status = await (await get("/connect/calendar/status?key=admin-test")).json();
  assert.equal(status.connected, true);
  assert.equal(status.email, "agent@gmail.com");

  const target = await calendar.getCalendarTarget();
  assert.equal(target.calendarId, "primary");
  assert.equal(target.auth.credentials.refresh_token, "refresh-123");
});

test("disconnecting removes the connection", async () => {
  const original = calendar.oauthClient;
  calendar.oauthClient = () => {
    const client = original();
    client.revokeToken = async () => {};
    return client;
  };
  try {
    const res = await fetch(base + "/connect/calendar/disconnect?key=admin-test", { method: "POST" });
    assert.deepEqual(await res.json(), { connected: false });
  } finally {
    calendar.oauthClient = original;
  }
  assert.equal(await getSetting(calendar.CALENDAR_CONNECTION_KEY), null);
  assert.equal(await calendar.getCalendarTarget(), null);
});
