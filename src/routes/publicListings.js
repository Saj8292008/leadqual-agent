const express = require("express");
const { listingStatements } = require("../db/listings");

const router = express.Router();

// Public API, fetched cross-origin from the marketing site — allow any
// origin to read it (it's read-only, published-listings-only, no auth to
// bypass), but don't loosen CORS on the rest of the app.
router.use("/public", (req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET");
  next();
});

// No auth on any of these — this is the public-facing "listings in your
// area" surface for the website. Only ever returns published listings,
// and only the fields safe to show a visitor (no internal status, no
// fact-check flags, no unpublished social copy).
router.get("/public/listings", (req, res) => {
  const { city, state, zip } = req.query;
  const rows = listingStatements.publicListings.all({
    city: city || null,
    state: state || null,
    zip: zip || null,
  });
  res.json(rows.map(formatListing));
});

router.get("/public/listings/:id", (req, res) => {
  const listing = listingStatements.publicListing.get(req.params.id);
  if (!listing) return res.status(404).json({ error: "not found" });
  res.json(formatListing(listing));
});

// Powers a "browse by area" picker on the site without the visitor having
// to already know what to search for.
router.get("/public/areas", (req, res) => {
  res.json(listingStatements.distinctCities.all());
});

function formatListing(listing) {
  return { ...listing, photo_urls: JSON.parse(listing.photo_urls || "[]") };
}

module.exports = router;
module.exports.formatListing = formatListing;
