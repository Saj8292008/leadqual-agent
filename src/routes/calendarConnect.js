const crypto = require("crypto");
const express = require("express");
const { requireAdminAuth } = require("../middleware/adminAuth");
const { getSetting, setSetting, deleteSetting } = require("../db/settings");
const calendar = require("../services/calendar");

const router = express.Router();

const OAUTH_STATE_KEY = "google_calendar_oauth_state";
const STATE_TTL_MS = 15 * 60 * 1000;
const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
];

function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5;color:#1a1a1a}</style>
</head><body><h1>${title}</h1>${body}</body></html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function oauthConfigured() {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET && process.env.PUBLIC_BASE_URL
  );
}

// The agent opens this link (with ?key=ADMIN_SECRET) and is sent to Google to
// let the app see their free/busy time and add showings to their calendar.
router.get("/connect/calendar", requireAdminAuth, async (req, res) => {
  if (!oauthConfigured()) {
    return res.status(500).send(page("Calendar connection isn't set up",
      "<p>GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and PUBLIC_BASE_URL must be configured first.</p>"));
  }
  // One-time state value ties Google's redirect back to a link the agent
  // actually opened, so nobody can connect their own calendar in its place.
  const state = crypto.randomBytes(24).toString("hex");
  await setSetting(OAUTH_STATE_KEY, { state, created_at: Date.now() });
  res.redirect(
    calendar.oauthClient().generateAuthUrl({
      access_type: "offline",
      prompt: "consent", // always return a refresh token, even on reconnect
      scope: SCOPES,
      state,
    })
  );
});

router.get("/connect/calendar/callback", async (req, res) => {
  const pending = await getSetting(OAUTH_STATE_KEY);
  const stateOk =
    pending &&
    typeof req.query.state === "string" &&
    req.query.state.length === pending.state.length &&
    crypto.timingSafeEqual(Buffer.from(req.query.state), Buffer.from(pending.state)) &&
    Date.now() - pending.created_at < STATE_TTL_MS;
  if (!stateOk) {
    return res.status(400).send(page("Link expired", "<p>Open the connect link again to retry.</p>"));
  }
  await deleteSetting(OAUTH_STATE_KEY);

  if (req.query.error || !req.query.code) {
    return res.status(400).send(page("Calendar not connected",
      `<p>Google said: ${escapeHtml(req.query.error || "no authorization code")}. Open the connect link again to retry.</p>`));
  }

  try {
    const { tokens } = await calendar.oauthClient().getToken(String(req.query.code));
    if (!tokens.refresh_token) throw new Error("Google did not return a refresh token");
    // The ID token arrived straight from Google's token endpoint over TLS,
    // so reading the email claim without re-verifying the signature is safe.
    const email = tokens.id_token
      ? JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64url").toString()).email
      : null;
    await setSetting(calendar.CALENDAR_CONNECTION_KEY, {
      refresh_token: tokens.refresh_token,
      email,
      connected_at: new Date().toISOString(),
    });
    res.send(page("Calendar connected ✓",
      `<p>Showings will now be booked on <strong>${escapeHtml(email || "your Google Calendar")}</strong>, and leads will only be offered times you're free.</p><p>You can close this tab.</p>`));
  } catch (err) {
    console.error("[calendar] OAuth callback failed:", err);
    res.status(500).send(page("Calendar not connected", "<p>Something went wrong talking to Google. Open the connect link again to retry.</p>"));
  }
});

router.get("/connect/calendar/status", requireAdminAuth, async (req, res) => {
  const connection = await getSetting(calendar.CALENDAR_CONNECTION_KEY);
  res.json(connection
    ? { connected: true, email: connection.email, connected_at: connection.connected_at }
    : { connected: false });
});

router.post("/connect/calendar/disconnect", requireAdminAuth, async (req, res) => {
  const connection = await getSetting(calendar.CALENDAR_CONNECTION_KEY);
  if (connection?.refresh_token) {
    await calendar.oauthClient().revokeToken(connection.refresh_token).catch((err) =>
      console.error("[calendar] token revoke failed (removing locally anyway):", err.message)
    );
  }
  await deleteSetting(calendar.CALENDAR_CONNECTION_KEY);
  res.json({ connected: false });
});

module.exports = router;
