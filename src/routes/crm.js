const crypto = require("crypto");
const express = require("express");
const { inBackground } = require("../lib/background");
const { statements } = require("../db");
const { runTurn } = require("../services/conversationEngine");
const { formatForAgent } = require("../lib/time");

// The agent's CRM: their pipeline of leads, every conversation Sam has had,
// their own notes, and controls to take a lead over from Sam or hand it back.
// Server-rendered HTML so it works on a phone with no app or build step.

const router = express.Router();
router.use("/crm", express.urlencoded({ extended: false }));

// --- Auth ------------------------------------------------------------------
// The agent opens /crm/login?key=<ADMIN_SECRET> once; a cookie keeps them
// signed in so the key doesn't sit in the address bar or browser history.
// SameSite=Lax lets the cookie ride along when they tap a link to the CRM
// from email, but not on another site's form posts; POSTs also check Origin.

const COOKIE = "crm_session";
const SESSION_DAYS = 60;

function sessionToken() {
  return crypto.createHmac("sha256", process.env.ADMIN_SECRET || "").update("crm-session-v1").digest("hex");
}

function cookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .map((c) => c.trim().split("="))
      .filter(([k, v]) => k && v)
      .map(([k, v]) => [k, decodeURIComponent(v)])
  );
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function cleanKey(raw) {
  // Same tolerance as adminAuth: pasted links pick up stray characters.
  return typeof raw === "string" ? raw.replace(/[^A-Za-z0-9_-]/g, "") : "";
}

function requireCrmSession(req, res, next) {
  if (!process.env.ADMIN_SECRET) return res.status(500).send("CRM is not configured.");
  if (!safeEqual(cookies(req)[COOKIE] || "", sessionToken())) {
    return res.status(401).send(page("Sign in", `<div class="card"><h2>Open your CRM link to sign in</h2>
      <p class="muted">Use the private CRM link you were sent. It signs you in on this device for ${SESSION_DAYS} days.</p></div>`));
  }
  if (req.method === "POST") {
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) return res.status(403).send("Forbidden");
  }
  next();
}

router.get("/crm/login", (req, res) => {
  if (!process.env.ADMIN_SECRET || !safeEqual(cleanKey(req.query.key), process.env.ADMIN_SECRET)) {
    return res.status(401).send(page("Sign in", `<div class="card"><h2>That link didn't work</h2>
      <p class="muted">Make sure you opened the whole CRM link — it's long and sometimes gets cut off when copied.</p></div>`));
  }
  const secure = req.secure || req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  res.set(
    "Set-Cookie",
    `${COOKIE}=${sessionToken()}; Path=/crm; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`
  );
  res.redirect(303, "/crm");
});

// --- Rendering ---------------------------------------------------------------

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// SQLite datetime('now') is UTC without a zone marker.
function when(sqlTime) {
  if (!sqlTime) return "";
  const d = new Date(String(sqlTime).includes("T") ? sqlTime : `${sqlTime.replace(" ", "T")}Z`);
  return formatForAgent(d, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const STAGES = [
  { key: "needs", title: "Needs you", hint: "Sam handed these to you — reply to them directly", statuses: ["handoff"] },
  { key: "booked", title: "Showing booked", hint: "On your calendar", statuses: ["booked"] },
  { key: "talking", title: "Sam is talking", hint: "Being qualified by Sam", statuses: ["new", "qualifying"] },
  { key: "later", title: "Following up later", hint: "Not ready yet — Sam will check back", statuses: ["nurture"] },
  { key: "closed", title: "Closed", hint: "Not interested, unsubscribed, or closed by you", statuses: ["dead"] },
];

function stageOf(lead) {
  return STAGES.find((s) => s.statuses.includes(lead.status)) || STAGES[2];
}

function agentName() {
  return process.env.AGENT_NAME || "Your";
}

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} — CRM</title>
<style>
  :root{--bg:#f6f7f9;--card:#fff;--text:#16181d;--muted:#667085;--line:#e4e7ec;--accent:#1f6feb;
    --needs:#c2410c;--needs-bg:#fff4ed;--sam:#eef4ff;--lead:#f2f4f7;--on-accent:#fff}
  @media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#171a21;--text:#e8eaed;--muted:#98a2b3;--line:#2a2f3a;
    --accent:#6ea8fe;--needs:#fb923c;--needs-bg:#2a1a10;--sam:#16233b;--lead:#1f232c;--on-accent:#0b1220}}
  *{box-sizing:border-box} body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);line-height:1.45}
  header{position:sticky;top:0;background:var(--card);border-bottom:1px solid var(--line);padding:12px 16px;display:flex;gap:12px;align-items:center;justify-content:space-between;z-index:1}
  a{color:var(--accent)} header a{color:var(--text);text-decoration:none;font-weight:600}
  main{max-width:860px;margin:0 auto;padding:16px}
  .btn{display:inline-block;border:1px solid var(--line);background:var(--card);color:var(--text);padding:8px 14px;border-radius:10px;font:inherit;font-weight:600;cursor:pointer;text-decoration:none}
  .btn.primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
  .btn.warn{color:var(--needs);border-color:var(--needs)}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin:10px 0}
  .muted{color:var(--muted)} .small{font-size:.875rem}
  h2{font-size:1.05rem;margin:22px 0 4px} h1{font-size:1.3rem;margin:4px 0}
  .stage-needs h2{color:var(--needs)} .stage-needs .card{border-color:var(--needs);background:var(--needs-bg)}
  a.lead{display:block;color:inherit;text-decoration:none}
  .row{display:flex;justify-content:space-between;gap:12px;align-items:baseline;flex-wrap:wrap}
  .pill{display:inline-block;font-size:.75rem;padding:2px 8px;border-radius:999px;border:1px solid var(--line);color:var(--muted)}
  .msg{border-radius:14px;padding:10px 12px;margin:8px 0;max-width:92%;white-space:pre-wrap;word-wrap:break-word}
  .msg.out{background:var(--sam);margin-left:auto} .msg.in{background:var(--lead)}
  .msg .who{font-size:.75rem;color:var(--muted);margin-bottom:4px}
  label{display:block;font-weight:600;margin:12px 0 4px} input,select,textarea{width:100%;padding:10px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--text);font:inherit}
  textarea{min-height:80px} .check{display:flex;gap:8px;align-items:center;font-weight:400} .check input{width:auto}
  .actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px} .actions form{margin:0}
  .error{color:var(--needs);font-weight:600}
  dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:8px 0} dt{color:var(--muted)} dd{margin:0}
</style></head><body>
<header><a href="/crm">${esc(agentName() === "Your" ? "Your" : agentName() + "'s")} leads</a><a class="btn primary" href="/crm/new">+ Add lead</a></header>
<main>${body}</main></body></html>`;
}

// --- Pipeline -------------------------------------------------------------------

router.get("/crm", requireCrmSession, async (req, res) => {
  const leads = await statements.crmLeads.all();
  if (!leads.length) {
    return res.send(page("Leads", `<div class="card"><h2>No leads yet</h2>
      <p class="muted">New leads from your website and ads will show up here as soon as they come in, and Sam will start talking to them right away.
      You can also <a href="/crm/new">add a lead yourself</a>.</p></div>`));
  }
  const sections = STAGES.map((stage) => {
    const inStage = leads.filter((l) => stageOf(l).key === stage.key);
    if (!inStage.length) return "";
    const cards = inStage
      .map(
        (l) => `<a class="lead card" href="/crm/leads/${l.id}">
      <div class="row"><strong>${esc(l.name || l.email)}</strong><span class="muted small">${esc(when(l.last_message_at || l.created_at))}</span></div>
      <div class="muted small">${[l.source, l.budget, l.timeline].filter(Boolean).map(esc).join(" · ")}</div>
      ${l.opted_out_at ? '<span class="pill">Unsubscribed</span>' : ""}</a>`
      )
      .join("");
    return `<section class="stage-${stage.key}"><h2>${stage.title} (${inStage.length})</h2><div class="muted small">${stage.hint}</div>${cards}</section>`;
  });
  res.send(page("Leads", sections.join("")));
});

// --- Lead detail ----------------------------------------------------------------

async function loadLead(req, res) {
  const lead = await statements.getLead.get(Number(req.params.id));
  if (!lead) {
    res.status(404).send(page("Not found", `<div class="card">That lead doesn't exist. <a href="/crm">Back to leads</a></div>`));
    return null;
  }
  return lead;
}

router.get("/crm/leads/:id", requireCrmSession, async (req, res) => {
  const lead = await loadLead(req, res);
  if (!lead) return;
  const messages = await statements.historyForLead.all(lead.id);
  const stage = stageOf(lead);

  const thread = messages.length
    ? messages
        .map(
          // No whitespace inside the bubble: it's white-space:pre-wrap.
          (m) =>
            `<div class="msg ${m.direction === "outbound" ? "out" : "in"}"><div class="who">${m.direction === "outbound" ? "Sam" : esc(lead.name || "Lead")} · ${esc(when(m.created_at))}</div>${esc(m.body.trim())}</div>`
        )
        .join("")
    : `<p class="muted">No messages yet.</p>`;

  const actions = [];
  if (!lead.opted_out_at) {
    if (lead.status === "handoff") {
      actions.push(`<form method="post" action="/crm/leads/${lead.id}/hand-back"><button class="btn primary">Hand back to Sam</button></form>`);
    } else if (lead.status !== "dead") {
      actions.push(`<form method="post" action="/crm/leads/${lead.id}/take-over"><button class="btn warn">Take over from Sam</button></form>`);
    }
    if (lead.status === "dead") {
      actions.push(`<form method="post" action="/crm/leads/${lead.id}/hand-back"><button class="btn">Reopen with Sam</button></form>`);
    } else {
      actions.push(`<form method="post" action="/crm/leads/${lead.id}/close"><button class="btn">Close lead</button></form>`);
    }
  }

  const samState = lead.opted_out_at
    ? "This lead unsubscribed — nobody will email them again."
    : lead.status === "handoff"
    ? "You're handling this lead. Sam won't reply; their messages are forwarded to you."
    : lead.status === "booked"
    ? "Showing booked. Sam won't reply; their messages are forwarded to you."
    : lead.status === "dead"
    ? "Closed. Sam won't reply."
    : "Sam is handling this lead.";

  res.send(
    page(
      lead.name || lead.email,
      `<a href="/crm" class="muted small">← All leads</a>
<div class="card">
  <div class="row"><h1>${esc(lead.name || lead.email)}</h1><span class="pill">${stage.title}</span></div>
  <dl>
    <dt>Email</dt><dd><a href="mailto:${esc(lead.email)}">${esc(lead.email)}</a></dd>
    ${lead.phone ? `<dt>Phone</dt><dd><a href="tel:${esc(lead.phone)}">${esc(lead.phone)}</a></dd>` : ""}
    <dt>Source</dt><dd>${esc(lead.source)}</dd>
    ${lead.budget ? `<dt>Budget</dt><dd>${esc(lead.budget)}</dd>` : ""}
    ${lead.timeline ? `<dt>Timeline</dt><dd>${esc(lead.timeline)}</dd>` : ""}
    ${lead.motivation ? `<dt>Looking for</dt><dd>${esc(lead.motivation)}</dd>` : ""}
    ${lead.notes ? `<dt>Sam's notes</dt><dd>${esc(lead.notes)}</dd>` : ""}
    <dt>Added</dt><dd>${esc(when(lead.created_at))}</dd>
  </dl>
  <p class="muted small">${samState}</p>
  <div class="actions">${actions.join("")}</div>
</div>

<h2>Your notes</h2>
<div class="card">
  ${lead.agent_notes ? `<div style="white-space:pre-wrap">${esc(lead.agent_notes)}</div>` : `<p class="muted small">Only you see these.</p>`}
  <form method="post" action="/crm/leads/${lead.id}/notes">
    <textarea name="note" required placeholder="e.g. Called — wants to see 3 homes Saturday"></textarea>
    <div class="actions"><button class="btn">Add note</button></div>
  </form>
</div>

<h2>Conversation</h2>
<div class="card">${thread}</div>`
    )
  );
});

async function setStatus(req, res, status, allowed) {
  const lead = await loadLead(req, res);
  if (!lead) return;
  if (lead.opted_out_at || !allowed(lead)) return res.redirect(303, `/crm/leads/${lead.id}`);
  await statements.setStatus.run({ id: lead.id, status });
  res.redirect(303, `/crm/leads/${lead.id}`);
}

// Taking over uses the same "handoff" status Sam sets: Sam goes quiet and the
// lead's replies are forwarded to the agent.
router.post("/crm/leads/:id/take-over", requireCrmSession, (req, res) =>
  setStatus(req, res, "handoff", (l) => !["handoff", "dead"].includes(l.status))
);
router.post("/crm/leads/:id/hand-back", requireCrmSession, (req, res) =>
  setStatus(req, res, "qualifying", (l) => ["handoff", "dead"].includes(l.status))
);
router.post("/crm/leads/:id/close", requireCrmSession, (req, res) =>
  setStatus(req, res, "dead", (l) => l.status !== "dead")
);

router.post("/crm/leads/:id/notes", requireCrmSession, async (req, res) => {
  const lead = await loadLead(req, res);
  if (!lead) return;
  const note = String(req.body.note || "").trim().slice(0, 2000);
  if (note) await statements.appendAgentNote.run({ id: lead.id, note: `${when(new Date().toISOString())}: ${note}` });
  res.redirect(303, `/crm/leads/${lead.id}`);
});

// --- Add a lead by hand -------------------------------------------------------

const SOURCES = ["Referral", "Open house", "Phone call", "Website", "Facebook", "Zillow", "Other"];
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function newLeadForm(values = {}, error = "") {
  return page(
    "Add lead",
    `<a href="/crm" class="muted small">← All leads</a>
<div class="card"><h1>Add a lead</h1>
${error ? `<p class="error">${esc(error)}</p>` : ""}
<form method="post" action="/crm/leads">
  <label for="name">Name</label><input id="name" name="name" value="${esc(values.name)}" autocomplete="off">
  <label for="email">Email *</label><input id="email" name="email" type="email" required value="${esc(values.email)}" autocomplete="off">
  <label for="phone">Phone</label><input id="phone" name="phone" type="tel" value="${esc(values.phone)}" autocomplete="off">
  <label for="source">Where they came from</label>
  <select id="source" name="source">${SOURCES.map((s) => `<option${values.source === s ? " selected" : ""}>${s}</option>`).join("")}</select>
  <label for="notes">What they're looking for</label>
  <textarea id="notes" name="notes" placeholder="e.g. Met at open house on Elm St, wants 3 bed under $450k">${esc(values.notes)}</textarea>
  <label class="check"><input type="checkbox" name="reach_out" value="1"${values.reach_out === undefined || values.reach_out ? " checked" : ""}> Have Sam email them now</label>
  <div class="actions"><button class="btn primary">Add lead</button></div>
</form></div>`
  );
}

router.get("/crm/new", requireCrmSession, (req, res) => res.send(newLeadForm()));

router.post("/crm/leads", requireCrmSession, async (req, res) => {
  const values = {
    name: String(req.body.name || "").trim().slice(0, 200),
    email: String(req.body.email || "").trim().slice(0, 200),
    phone: String(req.body.phone || "").trim().slice(0, 50),
    source: SOURCES.includes(req.body.source) ? req.body.source : "Other",
    notes: String(req.body.notes || "").trim().slice(0, 2000),
    reach_out: req.body.reach_out === "1",
  };
  if (!EMAIL_RE.test(values.email)) return res.status(400).send(newLeadForm(values, "Please enter a valid email address."));
  const existing = await statements.findLeadByEmail.get(values.email);
  if (existing) {
    return res
      .status(409)
      .send(newLeadForm(values, `${values.email} is already a lead.`).replace("</form>", `</form><p><a href="/crm/leads/${existing.id}">Open their page →</a></p>`));
  }

  const info = await statements.insertLead.run({
    source: values.source.toLowerCase(),
    name: values.name || null,
    email: values.email,
    notes: values.notes || null,
  });
  const id = info.lastInsertRowid;
  if (values.phone) await statements.setPhone.run({ id, phone: values.phone });
  if (values.reach_out) {
    inBackground(runTurn(id).catch((err) => console.error(`[crm] first email to lead ${id} failed:`, err)));
  } else {
    // Added for the agent's own records — Sam stays out of it.
    await statements.setStatus.run({ id, status: "handoff" });
  }
  res.redirect(303, `/crm/leads/${id}`);
});

module.exports = router;
