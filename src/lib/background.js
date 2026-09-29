const { waitUntil } = require("@vercel/functions");

// Work that continues after the HTTP response is sent (e.g. the AI reply to
// an inbound email). Serverless platforms freeze the function once it has
// responded; waitUntil keeps it alive until this promise settles. Off Vercel
// it's a no-op and the promise simply runs on the long-lived process.
function inBackground(promise) {
  waitUntil(promise);
  return promise;
}

module.exports = { inBackground };
