const express = require("express");
const { listingStatements } = require("../db/listings");
const listingContent = require("../services/listingContent");
const { renderFlyerHtml } = require("../services/flyer");
const { checkContent } = require("../services/factCheck");
const { requireAdminAuth } = require("../middleware/adminAuth");

const router = express.Router();

// Intake for a new listing going to market. Point your MLS export, a
// spreadsheet-to-webhook (Zapier), or a manual form here.
router.post("/webhooks/listing", async (req, res) => {
  if (req.headers["x-webhook-secret"] !== process.env.LEAD_WEBHOOK_SECRET) {
    return res.status(401).json({ error: "bad secret" });
  }

  const { address, price, beds, baths, sqft, features, photo_urls } = req.body;
  if (!address) return res.status(400).json({ error: "address is required" });

  const info = listingStatements.insertListing.run({
    address,
    price: price || null,
    beds: beds || null,
    baths: baths || null,
    sqft: sqft || null,
    features: features || null,
    photo_urls: JSON.stringify(photo_urls || []),
  });

  res.status(201).json({ id: info.lastInsertRowid });

  generateContentFor(info.lastInsertRowid).catch((err) =>
    console.error(`[listing ${info.lastInsertRowid}] content generation failed:`, err)
  );
});

async function generateContentFor(listingId) {
  const listing = listingStatements.getListing.get(listingId);
  const content = await listingContent.generate(listing);
  const flags = checkContent(content, listing);
  listingStatements.saveGeneratedContent.run({
    id: listingId,
    ...content,
    status: flags.length ? "needs_review" : "generated",
    fact_check_flags: flags.length ? JSON.stringify(flags) : null,
  });
}

// Re-run generation (e.g. after editing raw facts) without re-posting the listing.
router.post("/listings/:id/regenerate", requireAdminAuth, async (req, res) => {
  const listing = listingStatements.getListing.get(req.params.id);
  if (!listing) return res.status(404).json({ error: "not found" });
  try {
    await generateContentFor(listing.id);
    res.json(listingStatements.getListing.get(listing.id));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get("/listings", requireAdminAuth, (req, res) => {
  res.json(listingStatements.listListings.all());
});

router.get("/listings/:id", requireAdminAuth, (req, res) => {
  const listing = listingStatements.getListing.get(req.params.id);
  if (!listing) return res.status(404).json({ error: "not found" });
  res.json(listing);
});

router.get("/listings/:id/flyer", requireAdminAuth, (req, res) => {
  const listing = listingStatements.getListing.get(req.params.id);
  if (!listing) return res.status(404).send("not found");
  res.set("Content-Type", "text/html");
  res.send(renderFlyerHtml(listing));
});

// Clear a needs_review flag after a human has checked the flagged claims —
// either the copy gets edited first, or this just confirms it's fine as-is.
router.post("/listings/:id/clear-review", requireAdminAuth, (req, res) => {
  const listing = listingStatements.getListing.get(req.params.id);
  if (!listing) return res.status(404).json({ error: "not found" });
  if (listing.status !== "needs_review") {
    return res.status(400).json({ error: "listing is not pending review" });
  }
  listingStatements.clearReview.run({ id: listing.id });
  res.json(listingStatements.getListing.get(listing.id));
});

router.post("/listings/:id/publish", requireAdminAuth, (req, res) => {
  const listing = listingStatements.getListing.get(req.params.id);
  if (!listing) return res.status(404).json({ error: "not found" });
  if (listing.status === "needs_review") {
    return res.status(400).json({
      error: "flagged content needs review before publishing",
      flags: JSON.parse(listing.fact_check_flags || "[]"),
    });
  }
  if (listing.status !== "generated") {
    return res.status(400).json({ error: "content not generated yet" });
  }
  listingStatements.markPublished.run({ id: listing.id });
  res.json({ ok: true });
});

module.exports = router;
