const { test } = require("node:test");
const assert = require("node:assert/strict");
const { renderFlyerHtml } = require("../src/services/flyer");

test("renderFlyerHtml includes address, price, and description", () => {
  const html = renderFlyerHtml({
    address: "123 Main St",
    price: "$450,000",
    beds: 3,
    baths: 2,
    sqft: 1800,
    description: "A lovely home.",
    photo_urls: JSON.stringify(["https://example.com/a.jpg", "https://example.com/b.jpg"]),
  });

  assert.match(html, /123 Main St/);
  assert.match(html, /\$450,000/);
  assert.match(html, /A lovely home\./);
  assert.match(html, /class="hero" src="https:\/\/example\.com\/a\.jpg"/);
});

test("renderFlyerHtml escapes HTML in listing fields", () => {
  const html = renderFlyerHtml({
    address: "<script>alert(1)</script>",
    photo_urls: "[]",
  });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test("renderFlyerHtml handles missing photos and optional fields", () => {
  const html = renderFlyerHtml({ address: "456 Oak Ave", photo_urls: null });
  assert.match(html, /456 Oak Ave/);
  assert.doesNotMatch(html, /class="hero"/);
});
