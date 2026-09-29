require("dotenv").config();
const express = require("express");

const { db } = require("./db");
const leadsRouter = require("./routes/leads");
const emailRouter = require("./routes/email");
const inspectRouter = require("./routes/inspect");
const listingsRouter = require("./routes/listings");
const transactionsRouter = require("./routes/transactions");
const propertyManagementRouter = require("./routes/propertyManagement");
const publicListingsRouter = require("./routes/publicListings");
const calendarConnectRouter = require("./routes/calendarConnect");

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

const port = process.env.PORT || 3000;
const server = app.listen(port, () => console.log(`leadqual-agent listening on :${port}`));

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
