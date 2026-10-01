const { waitUntil } = require("@vercel/functions");

// Same lookup @vercel/functions does internally (that module isn't exported).
function vercelRequestContext() {
  return globalThis[Symbol.for("@vercel/request-context")]?.get?.() ?? {};
}

// Work that continues after the HTTP response is sent (e.g. the AI reply to
// an inbound email). Serverless platforms freeze the function once it has
// responded; waitUntil keeps it alive until this promise settles. Off Vercel
// it's a no-op and the promise simply runs on the long-lived process.
function inBackground(promise) {
  if (process.env.VERCEL && !vercelRequestContext().waitUntil) {
    console.warn("[background] no waitUntil in request context — work after the response may be frozen");
  }
  waitUntil(promise);
  return promise;
}

module.exports = { inBackground };
