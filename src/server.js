require("dotenv").config();
const express = require("express");

const { db } = require("./db");
const leadsRouter = require("./routes/leads");
const emailRouter = require("./routes/email");
const inspectRouter = require("./routes/inspect");

const app = express();
app.use(express.json());

app.get("/health", (req, res) => res.json({ ok: true }));

app.use(leadsRouter);
app.use(emailRouter);
app.use(inspectRouter);

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
