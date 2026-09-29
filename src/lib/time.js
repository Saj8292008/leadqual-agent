// Serverless hosts (Vercel) and hosted databases (Turso) run on UTC and
// don't let us set TZ, so "today", business hours and displayed times are
// all computed explicitly in the agent's timezone rather than the server's.
function agentTimeZone() {
  return process.env.AGENT_TIMEZONE || "America/Chicago";
}

// Calendar parts of `date` as seen in the agent's timezone.
function zonedParts(date = new Date(), timeZone = agentTimeZone()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: parts.weekday, // "Mon".."Sun"
  };
}

// 'YYYY-MM-DD' for today (or `date`) in the agent's timezone.
function localDate(date = new Date(), timeZone = agentTimeZone()) {
  const { year, month, day } = zonedParts(date, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Whole calendar days from today (agent's timezone) to a 'YYYY-MM-DD' date.
function daysUntil(dueDate, now = new Date()) {
  const toUtcMidnight = (ymd) => {
    const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtcMidnight(dueDate) - toUtcMidnight(localDate(now))) / (24 * 60 * 60 * 1000));
}

// Formats an instant for a lead/agent to read, in the agent's timezone.
function formatForAgent(date, options) {
  return new Date(date).toLocaleString("en-US", { ...options, timeZone: agentTimeZone() });
}

module.exports = { agentTimeZone, zonedParts, localDate, daysUntil, formatForAgent };
