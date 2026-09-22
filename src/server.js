require("dotenv").config();
const express = require("express");

const { db } = require("./db");
const leadsRouter = require("./routes/leads");
const emailRouter = require("./routes/email");
const inspectRouter = require("./routes/inspect");
const listingsRouter = require("./routes/listings");
const transactionsRouter = require("./routes/transactions");
const propertyManagementRouter = require("./routes/propertyManagement");

const app = express();
app.use(express.json());

app.get("/health", (req, res) => res.json({ ok: true }));

app.use(leadsRouter);
app.use(emailRouter);
app.use(inspectRouter);
app.use(listingsRouter);
app.use(transactionsRouter);
app.use(propertyManagementRouter);

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
