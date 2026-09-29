const fs = require("fs");
const { google } = require("googleapis");
const { getSetting } = require("../db/settings");
const { agentTimeZone, zonedParts } = require("../lib/time");

const CALENDAR_CONNECTION_KEY = "google_calendar";

function oauthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    `${(process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "")}/connect/calendar/callback`
  );
}

// Which calendar to use and how to authenticate. Preference order:
//   1. The agent connected their own Google account via /connect/calendar
//   2. A service account + AGENT_CALENDAR_ID in .env (developer setup)
//   3. Neither — null, and callers fall back to stub slots / dry-run booking
async function getCalendarTarget() {
  const connection = await getSetting(CALENDAR_CONNECTION_KEY);
  if (connection?.refresh_token) {
    const auth = oauthClient();
    auth.setCredentials({ refresh_token: connection.refresh_token });
    return { auth, calendarId: "primary" };
  }

  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (keyPath && fs.existsSync(keyPath) && process.env.AGENT_CALENDAR_ID) {
    const auth = new google.auth.GoogleAuth({
      keyFile: keyPath,
      scopes: ["https://www.googleapis.com/auth/calendar"],
    });
    return { auth, calendarId: process.env.AGENT_CALENDAR_ID };
  }

  return null;
}

// Returns a handful of open 1-hour slots over the next N business days.
// Falls back to a stub list when no service account is configured, so the
// conversation flow can be exercised end-to-end before calendar creds exist.
async function getAvailability({ days = 5 } = {}) {
  const target = await getCalendarTarget();
  if (!target) {
    return stubSlots(days);
  }

  const calendar = google.calendar({ version: "v3", auth: target.auth });
  const timeMin = new Date();
  const timeMax = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  const { data } = await calendar.freebusy.query({
    requestBody: {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: target.calendarId }],
    },
  });

  const busy = data.calendars[target.calendarId].busy || [];
  // Filter the full list before capping, so a busy morning doesn't leave
  // the lead with fewer options than we could have offered.
  return candidateSlots(timeMin, timeMax, Infinity)
    .filter((slot) => !busy.some((b) => overlaps(slot, b)))
    .slice(0, 6);
}

async function bookShowing({ lead, slot }) {
  const target = await getCalendarTarget();
  const summary = `Showing: ${lead.name || "New lead"} (${lead.email})`;
  const description = `Source: ${lead.source}\nBudget: ${lead.budget}\nTimeline: ${lead.timeline}\nMotivation: ${lead.motivation}`;

  if (!target) {
    console.log(`[calendar:dry-run] booked ${summary} at ${slot.start}`);
    return { id: "dry-run", htmlLink: null };
  }

  const calendar = google.calendar({ version: "v3", auth: target.auth });
  const event = await calendar.events.insert({
    calendarId: target.calendarId,
    requestBody: {
      summary,
      description,
      start: { dateTime: slot.start, timeZone: agentTimeZone() },
      end: { dateTime: slot.end, timeZone: agentTimeZone() },
    },
  });
  return event.data;
}

const HOUR_MS = 60 * 60 * 1000;

// Hour-long weekday slots between 9am and 5pm in the agent's timezone (the
// server's own clock is UTC on Vercel), starting from the next full hour.
function candidateSlots(from, to, limit = 6) {
  const slots = [];
  let cursor = Math.ceil(new Date(from).getTime() / HOUR_MS) * HOUR_MS;
  while (cursor < new Date(to).getTime() && slots.length < limit) {
    const { weekday, hour } = zonedParts(new Date(cursor));
    if (weekday !== "Sat" && weekday !== "Sun" && hour >= 9 && hour < 17) {
      slots.push({ start: new Date(cursor).toISOString(), end: new Date(cursor + HOUR_MS).toISOString() });
    }
    cursor += HOUR_MS;
  }
  return slots;
}

function stubSlots(days) {
  return candidateSlots(new Date(), new Date(Date.now() + days * 24 * 60 * 60 * 1000));
}

function overlaps(slot, busy) {
  return new Date(slot.start) < new Date(busy.end) && new Date(slot.end) > new Date(busy.start);
}

module.exports = { getAvailability, bookShowing, candidateSlots, oauthClient, getCalendarTarget, CALENDAR_CONNECTION_KEY };
