require("dotenv").config();
const express = require("express");

const leadsRouter = require("./routes/leads");
const emailRouter = require("./routes/email");

const app = express();
app.use(express.json());

app.get("/health", (req, res) => res.json({ ok: true }));

app.use(leadsRouter);
app.use(emailRouter);

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`leadqual-agent listening on :${port}`));
