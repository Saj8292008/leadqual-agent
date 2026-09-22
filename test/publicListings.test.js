const { test } = require("node:test");
const assert = require("node:assert/strict");
const { formatListing } = require("../src/routes/publicListings");

test("formatListing parses photo_urls JSON into an array", () => {
  const result = formatListing({ id: 1, address: "123 Main St", photo_urls: '["https://a.jpg","https://b.jpg"]' });
  assert.deepEqual(result.photo_urls, ["https://a.jpg", "https://b.jpg"]);
});

test("formatListing defaults to an empty array when photo_urls is missing", () => {
  const result = formatListing({ id: 1, address: "123 Main St", photo_urls: null });
  assert.deepEqual(result.photo_urls, []);
});

test("formatListing preserves other fields untouched", () => {
  const result = formatListing({ id: 1, address: "123 Main St", city: "Austin", price: "$450,000", photo_urls: "[]" });
  assert.equal(result.city, "Austin");
  assert.equal(result.price, "$450,000");
});
