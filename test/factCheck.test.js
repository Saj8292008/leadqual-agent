const { test } = require("node:test");
const assert = require("node:assert/strict");
const { checkContent } = require("../src/services/factCheck");

const listing = {
  address: "123 Main St",
  features: "pool, updated kitchen, corner lot",
};

test("flags a fabricated proximity claim (observed from qwen2.5:3b)", () => {
  const content = {
    social_facebook: "Stunning 3BR/2BA home in a prime corner lot just minutes from downtown.",
  };
  const flags = checkContent(content, listing);
  assert.equal(flags.length, 1);
  assert.equal(flags[0].field, "social_facebook");
  assert.equal(flags[0].label, "proximity claim");
});

test("flags a fabricated school claim", () => {
  const content = { description: "Located in a top-rated school district." };
  const flags = checkContent(content, listing);
  assert.equal(flags.length, 1);
  assert.equal(flags[0].label, "school claim");
});

test("does not flag clean copy grounded in the given facts", () => {
  const content = {
    description: "A lovely 3BR home with a pool, updated kitchen, and corner lot.",
    social_instagram: "New listing! Pool, updated kitchen, corner lot. #newhome",
  };
  const flags = checkContent(content, listing);
  assert.equal(flags.length, 0);
});

test("does not flag a proximity phrase that's actually in the provided facts", () => {
  const nearbyListing = { address: "123 Main St", features: "walking distance to the park" };
  const content = { description: "This home is walking distance to the park." };
  const flags = checkContent(content, nearbyListing);
  assert.equal(flags.length, 0);
});

test("checks every string field, not just description", () => {
  const content = {
    description: "Clean copy.",
    email_body: "Close to downtown shopping!",
  };
  const flags = checkContent(content, listing);
  assert.equal(flags.length, 1);
  assert.equal(flags[0].field, "email_body");
});
