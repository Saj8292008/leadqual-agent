const { db } = require("./index");

db.exec(`
  CREATE TABLE IF NOT EXISTS listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT NOT NULL,
    price TEXT,
    beds INTEGER,
    baths REAL,
    sqft INTEGER,
    features TEXT,               -- freeform notes: "pool, updated kitchen, corner lot"
    photo_urls TEXT,              -- JSON array of image URLs
    status TEXT NOT NULL DEFAULT 'new', -- new | generated | needs_review | published
    description TEXT,
    social_instagram TEXT,
    social_facebook TEXT,
    email_subject TEXT,
    email_body TEXT,
    fact_check_flags TEXT,        -- JSON array of {field, label, matched}, set when status = needs_review
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const listingStatements = {
  insertListing: db.prepare(`
    INSERT INTO listings (address, price, beds, baths, sqft, features, photo_urls)
    VALUES (@address, @price, @beds, @baths, @sqft, @features, @photo_urls)
  `),
  getListing: db.prepare(`SELECT * FROM listings WHERE id = ?`),
  listListings: db.prepare(`SELECT * FROM listings ORDER BY updated_at DESC`),
  saveGeneratedContent: db.prepare(`
    UPDATE listings SET
      status = @status,
      description = @description,
      social_instagram = @social_instagram,
      social_facebook = @social_facebook,
      email_subject = @email_subject,
      email_body = @email_body,
      fact_check_flags = @fact_check_flags,
      updated_at = datetime('now')
    WHERE id = @id
  `),
  clearReview: db.prepare(`
    UPDATE listings SET status = 'generated', updated_at = datetime('now') WHERE id = @id
  `),
  markPublished: db.prepare(`
    UPDATE listings SET status = 'published', updated_at = datetime('now') WHERE id = @id
  `),
};

module.exports = { listingStatements };
