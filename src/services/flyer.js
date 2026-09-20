// Renders a simple single-page HTML flyer. Print-to-PDF from a browser (or
// pipe through a headless-Chrome/PDF service later) gets you a printable flyer
// without pulling in a PDF library for the MVP.
function renderFlyerHtml(listing) {
  const photos = JSON.parse(listing.photo_urls || "[]");
  const heroPhoto = photos[0];
  const gallery = photos.slice(1, 5);

  const escape = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escape(listing.address)}</title>
<style>
  body { font-family: Georgia, serif; margin: 0; color: #1a1a1a; }
  .hero { width: 100%; height: 360px; object-fit: cover; }
  .content { padding: 32px 48px; }
  h1 { font-size: 28px; margin: 0 0 4px; }
  .price { font-size: 22px; color: #8a6d3b; margin: 0 0 16px; }
  .facts { display: flex; gap: 24px; margin-bottom: 20px; font-size: 14px; color: #444; }
  .description { font-size: 15px; line-height: 1.6; margin-bottom: 24px; }
  .gallery { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .gallery img { width: 100%; height: 120px; object-fit: cover; }
</style>
</head>
<body>
  ${heroPhoto ? `<img class="hero" src="${escape(heroPhoto)}" alt="">` : ""}
  <div class="content">
    <h1>${escape(listing.address)}</h1>
    ${listing.price ? `<p class="price">${escape(listing.price)}</p>` : ""}
    <div class="facts">
      ${listing.beds ? `<span>${escape(listing.beds)} bd</span>` : ""}
      ${listing.baths ? `<span>${escape(listing.baths)} ba</span>` : ""}
      ${listing.sqft ? `<span>${escape(listing.sqft)} sqft</span>` : ""}
    </div>
    <p class="description">${escape(listing.description || "")}</p>
    ${gallery.length ? `<div class="gallery">${gallery.map((p) => `<img src="${escape(p)}" alt="">`).join("")}</div>` : ""}
  </div>
</body>
</html>`;
}

module.exports = { renderFlyerHtml };
