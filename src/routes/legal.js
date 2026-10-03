const express = require("express");

const router = express.Router();

// Public privacy policy and terms of service. Google requires both, on the
// app's own domain, before an app using Calendar scopes can be published.
// The Google-data section has to describe exactly what the app does with
// Calendar access (see the Google API Services User Data Policy) — keep it
// in sync with src/routes/calendarConnect.js SCOPES and src/services/calendar.js.

const BUSINESS = "The Hub Agency";
const EFFECTIVE = "October 3, 2026";

function contactEmail() {
  return process.env.LEGAL_CONTACT_EMAIL || "the email address listed on thehubdeals.com";
}

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — ${BUSINESS}</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;max-width:46rem;margin:3rem auto;padding:0 1.25rem;line-height:1.6;color:#1a1a1a;background:#fff}
  h1{font-size:1.8rem;margin-bottom:.25rem} h2{font-size:1.15rem;margin-top:2rem}
  .meta{color:#666;margin-top:0} a{color:#0b5cad} li{margin:.3rem 0}
  @media (prefers-color-scheme:dark){body{background:#111;color:#e8e8e8}.meta{color:#999}a{color:#6fb1ff}}
</style></head><body>${body}
<p class="meta" style="margin-top:3rem"><a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Service</a></p>
</body></html>`;
}

router.get("/privacy", (req, res) => {
  const contact = contactEmail();
  res.send(page("Privacy Policy", `
<h1>Privacy Policy</h1>
<p class="meta">${BUSINESS} · Effective ${EFFECTIVE}</p>

<p>${BUSINESS} provides an AI assistant that real estate agents use to respond to and follow up with
people who inquire about buying or selling a home ("leads"), and to schedule property showings.
This policy explains what information the service handles and how.</p>

<h2>Who this applies to</h2>
<ul>
  <li><strong>Agents</strong> — real estate professionals who use the service and may connect their Google Calendar.</li>
  <li><strong>Leads</strong> — people who contact an agent (for example through the agent's website or ads) and receive emails from the agent's assistant.</li>
</ul>

<h2>Information we collect</h2>
<ul>
  <li><strong>Lead details</strong> provided by the lead or the agent's lead sources: name, email address, phone number, and what they asked about.</li>
  <li><strong>Email conversations</strong> between a lead and the agent's assistant, including what the lead shares about their budget, timeline and home search.</li>
  <li><strong>Agent account details</strong>: the agent's name, the email address where they receive alerts, and their time zone.</li>
  <li><strong>Google account data</strong>, only if the agent connects Google Calendar — described in the next section.</li>
</ul>

<h2>Google user data</h2>
<p>When an agent connects their Google Calendar, the service requests only these permissions:</p>
<ul>
  <li><strong>Email address</strong> — to show the agent which Google account is connected.</li>
  <li><strong>Calendar free/busy information</strong> — to see which times the agent is already busy, so leads are only offered open times. The service sees whether a time is busy, not the details of the agent's existing events.</li>
  <li><strong>Calendar events</strong> — to add a showing to the agent's calendar when a lead books one.</li>
</ul>
<p>Google user data is used only to provide these scheduling features to the agent who connected it. It is
<strong>not</strong> sold, <strong>not</strong> used for advertising, <strong>not</strong> transferred to others
except as needed to provide the service or comply with law, and <strong>not</strong> used to develop, improve
or train AI models. Calendar data is not sent to AI providers. ${BUSINESS}'s use of information received from
Google APIs adheres to the
<a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>,
including the Limited Use requirements.</p>
<p>We store a token that lets the service act on the connected calendar, and the connected Google email address.
An agent can disconnect at any time by asking us, or from their Google Account at
<a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>; the stored token is then
deleted or stops working.</p>

<h2>How we use information</h2>
<ul>
  <li>To reply to leads by email on the agent's behalf, ask qualifying questions, and offer and book showing times.</li>
  <li>To alert the agent when a lead needs personal attention.</li>
  <li>To send reminders the agent has set up (for example, transaction deadlines).</li>
</ul>

<h2>Service providers</h2>
<p>We use trusted providers to run the service: hosting (Vercel), database hosting (Turso), email delivery
(AgentMail), and an AI language model provider (Groq) that drafts replies to leads from the lead conversation.
These providers process data only to provide their services to us. Google Calendar data is not shared with the AI provider.</p>

<h2>Retention and deletion</h2>
<p>We keep lead and conversation records while the agent uses the service so the assistant can continue the
conversation. Agents and leads can ask us to delete their information at any time by emailing
<strong>${contact}</strong>, and we will delete it within 30 days, except where we must keep it by law.</p>

<h2>Security</h2>
<p>Data is encrypted in transit, stored with access controls, and access to each agent's data is restricted to that agent's account.</p>

<h2>Children</h2>
<p>The service is not directed to children under 13 and we do not knowingly collect their information.</p>

<h2>Changes</h2>
<p>We may update this policy and will change the effective date above when we do.</p>

<h2>Contact</h2>
<p>Questions or requests: <strong>${contact}</strong>.</p>
`));
});

router.get("/terms", (req, res) => {
  const contact = contactEmail();
  res.send(page("Terms of Service", `
<h1>Terms of Service</h1>
<p class="meta">${BUSINESS} · Effective ${EFFECTIVE}</p>

<p>These terms govern use of the ${BUSINESS} AI assistant service (the "Service") by real estate agents
("you"). By using the Service, you agree to them.</p>

<h2>The Service</h2>
<p>The Service responds to your leads by email on your behalf, asks qualifying questions, offers showing times
from your connected calendar, books showings, and alerts you when a lead needs personal attention. The Service
is currently offered as a beta and may change, and features may be added or removed.</p>

<h2>Your responsibilities</h2>
<ul>
  <li>You are responsible for the lead sources you connect and for having the right to contact the people who inquire with you.</li>
  <li>You remain responsible for your communications with leads and for compliance with laws and rules that apply to you, including real estate licensing, fair housing, and email and privacy laws.</li>
  <li>You will review alerts the Service sends you and follow up with leads that need a human.</li>
  <li>You will keep your account links and keys private.</li>
</ul>

<h2>AI-generated messages</h2>
<p>Replies to leads are drafted by an AI model. They are designed to be accurate and to avoid giving property
facts, pricing, legal or financial advice the assistant doesn't have, but AI can make mistakes. The Service does
not provide legal, financial or real estate advice.</p>

<h2>Google Calendar</h2>
<p>If you connect Google Calendar, the Service uses it only as described in our
<a href="/privacy">Privacy Policy</a>. You can disconnect at any time.</p>

<h2>Availability</h2>
<p>We work to keep the Service running reliably but don't guarantee it will be uninterrupted or error-free,
for example if an email, calendar or AI provider is unavailable.</p>

<h2>Limitation of liability</h2>
<p>To the extent permitted by law, ${BUSINESS} is not liable for indirect or consequential losses, including lost
deals or commissions, arising from use of the Service. The Service is provided "as is" during the beta.</p>

<h2>Ending use</h2>
<p>You can stop using the Service at any time. We may suspend access for misuse. On request we will delete your data as described in the Privacy Policy.</p>

<h2>Changes</h2>
<p>We may update these terms and will change the effective date above when we do.</p>

<h2>Contact</h2>
<p><strong>${contact}</strong></p>
`));
});

module.exports = router;
