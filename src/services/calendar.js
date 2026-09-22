const fs = require("fs");
const { google } = require("googleapis");

function getAuth() {
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!keyPath || !fs.existsSync(keyPath)) return null;
  return new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
}

// Returns a handful of open 1-hour slots over the next N business days.
// Falls back to a stub list when no service account is configured, so the
// conversation flow can be exercised end-to-end before calendar creds exist.
async function getAvailability({ days = 5 } = {}) {
  const auth = getAuth();
  if (!auth) {
    return stubSlots(days);
  }

  const calendar = google.calendar({ version: "v3", auth });
  const timeMin = new Date();
  const timeMax = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  const { data } = await calendar.freebusy.query({
    requestBody: {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: process.env.AGENT_CALENDAR_ID }],
    },
  });

  const busy = data.calendars[process.env.AGENT_CALENDAR_ID].busy || [];
  return candidateSlots(timeMin, timeMax).filter(
    (slot) => !busy.some((b) => overlaps(slot, b))
  );
}

async function bookShowing({ lead, slot }) {
  const auth = getAuth();
  const summary = `Showing: ${lead.name || "New lead"} (${lead.email})`;
  const description = `Source: ${lead.source}\nBudget: ${lead.budget}\nTimeline: ${lead.timeline}\nMotivation: ${lead.motivation}`;

  if (!auth) {
    console.log(`[calendar:dry-run] booked ${summary} at ${slot.start}`);
    return { id: "dry-run", htmlLink: null };
  }

  const calendar = google.calendar({ version: "v3", auth });
  const event = await calendar.events.insert({
    calendarId: process.env.AGENT_CALENDAR_ID,
    requestBody: {
      summary,
      description,
      start: { dateTime: slot.start, timeZone: process.env.AGENT_TIMEZONE },
      end: { dateTime: slot.end, timeZone: process.env.AGENT_TIMEZONE },
    },
  });
  return event.data;
}

function candidateSlots(from, to) {
  const slots = [];
  const cursor = new Date(from);
  cursor.setMinutes(0, 0, 0);
  while (cursor < to) {
    const day = cursor.getDay();
    const hour = cursor.getHours();
    if (day !== 0 && day !== 6 && hour >= 9 && hour < 17) {
      const start = new Date(cursor);
      const end = new Date(cursor.getTime() + 60 * 60 * 1000);
      slots.push({ start: start.toISOString(), end: end.toISOString() });
    }
    cursor.setHours(cursor.getHours() + 1);
  }
  return slots.slice(0, 6);
}

function stubSlots(days) {
  return candidateSlots(new Date(), new Date(Date.now() + days * 24 * 60 * 60 * 1000));
}

function overlaps(slot, busy) {
  return new Date(slot.start) < new Date(busy.end) && new Date(slot.end) > new Date(busy.start);
}

module.exports = { getAvailability, bookShowing, candidateSlots };
