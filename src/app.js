require("dotenv").config();
const express = require("express");

const leadsRouter = require("./routes/leads");
const emailRouter = require("./routes/email");
const inspectRouter = require("./routes/inspect");
const listingsRouter = require("./routes/listings");
const transactionsRouter = require("./routes/transactions");
const propertyManagementRouter = require("./routes/propertyManagement");
const publicListingsRouter = require("./routes/publicListings");
const calendarConnectRouter = require("./routes/calendarConnect");
const cronRouter = require("./routes/cron");
const legalRouter = require("./routes/legal");

// The Express app on its own, so it can be served by a long-running process
// (src/server.js) or imported as a Vercel function (api/index.js).
const app = express();
// Keep the exact bytes too: webhook signatures (AgentMail/Svix) are computed
// over the raw body, and re-serializing parsed JSON wouldn't match.
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

app.get("/health", (req, res) => res.json({ ok: true }));

app.use(leadsRouter);
app.use(emailRouter);
app.use(inspectRouter);
app.use(listingsRouter);
app.use(transactionsRouter);
app.use(propertyManagementRouter);
app.use(publicListingsRouter);
app.use(calendarConnectRouter);
app.use(cronRouter);
app.use(legalRouter);

// Express 5 routes rejected promises here — log it, and don't leak internals.
app.use((err, req, res, _next) => {
  console.error(`[${req.method} ${req.path}] unhandled error:`, err);
  if (!res.headersSent) res.status(500).json({ error: "internal error" });
});

module.exports = app;
