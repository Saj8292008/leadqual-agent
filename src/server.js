// Long-running server for local development (`npm start` / `npm run dev`).
// On Vercel the same app is served by api/index.js instead.
const app = require("./app");
const { client } = require("./db");

const port = process.env.PORT || 3000;
const server = app.listen(port, () => console.log(`leadqual-agent listening on :${port}`));

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close(() => {
      client.close();
      process.exit(0);
    });
  });
}
