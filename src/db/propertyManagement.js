const { schema, prepare } = require("./client");

schema(`
  CREATE TABLE IF NOT EXISTS properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT NOT NULL,
    landlord_name TEXT,
    landlord_email TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tenants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id INTEGER NOT NULL REFERENCES properties(id),
    unit TEXT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    lease_start TEXT,
    lease_end TEXT,
    rent_amount TEXT,
    rent_due_day INTEGER NOT NULL DEFAULT 1,  -- day of month, 1-28
    status TEXT NOT NULL DEFAULT 'active',    -- active | moved_out
    last_lease_reminder_days INTEGER,          -- last milestone (90/60/30) we've already reminded at
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS rent_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    period TEXT NOT NULL,       -- 'YYYY-MM'
    paid_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(tenant_id, period)
  );

  CREATE TABLE IF NOT EXISTS rent_reminders_sent (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    period TEXT NOT NULL,
    kind TEXT NOT NULL,         -- 'upcoming' | 'overdue'
    sent_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(tenant_id, period, kind)
  );

  CREATE TABLE IF NOT EXISTS maintenance_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    property_id INTEGER NOT NULL REFERENCES properties(id),
    description TEXT NOT NULL,
    category TEXT,               -- plumbing | electrical | hvac | appliance | structural | pest | other
    urgency TEXT,                -- emergency | urgent | routine
    vendor_message TEXT,
    status TEXT NOT NULL DEFAULT 'new', -- new | triaged | dispatched | resolved | triage_failed
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS vendors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_tenants_property ON tenants(property_id);
  CREATE INDEX IF NOT EXISTS idx_maintenance_tenant ON maintenance_requests(tenant_id);
`);

const propertyStatements = {
  insertProperty: prepare(`
    INSERT INTO properties (address, landlord_name, landlord_email)
    VALUES (@address, @landlord_name, @landlord_email)
  `),
  getProperty: prepare(`SELECT * FROM properties WHERE id = ?`),
  listProperties: prepare(`SELECT * FROM properties ORDER BY created_at DESC`),

  insertTenant: prepare(`
    INSERT INTO tenants (property_id, unit, name, email, phone, lease_start, lease_end, rent_amount, rent_due_day)
    VALUES (@property_id, @unit, @name, @email, @phone, @lease_start, @lease_end, @rent_amount, @rent_due_day)
  `),
  getTenant: prepare(`SELECT * FROM tenants WHERE id = ?`),
  listTenants: prepare(`SELECT * FROM tenants ORDER BY created_at DESC`),
  activeTenants: prepare(`SELECT * FROM tenants WHERE status = 'active'`),
  activeTenantsWithProperty: prepare(`
    SELECT t.*, p.address, p.landlord_email, p.landlord_name FROM tenants t
    JOIN properties p ON p.id = t.property_id
    WHERE t.status = 'active'
  `),
  markLeaseReminderSent: prepare(`
    UPDATE tenants SET last_lease_reminder_days = @days WHERE id = @id
  `),

  recordRentPayment: prepare(`
    INSERT OR IGNORE INTO rent_payments (tenant_id, period) VALUES (@tenant_id, @period)
  `),
  hasPaid: prepare(`SELECT 1 FROM rent_payments WHERE tenant_id = ? AND period = ?`),
  markRentReminderSent: prepare(`
    INSERT OR IGNORE INTO rent_reminders_sent (tenant_id, period, kind) VALUES (@tenant_id, @period, @kind)
  `),
  rentReminderAlreadySent: prepare(`
    SELECT 1 FROM rent_reminders_sent WHERE tenant_id = ? AND period = ? AND kind = ?
  `),

  insertMaintenanceRequest: prepare(`
    INSERT INTO maintenance_requests (tenant_id, property_id, description)
    VALUES (@tenant_id, @property_id, @description)
  `),
  getMaintenanceRequest: prepare(`SELECT * FROM maintenance_requests WHERE id = ?`),
  listMaintenanceRequests: prepare(`SELECT * FROM maintenance_requests ORDER BY created_at DESC`),
  saveTriage: prepare(`
    UPDATE maintenance_requests SET
      status = 'triaged', category = @category, urgency = @urgency,
      vendor_message = @vendor_message, updated_at = datetime('now')
    WHERE id = @id
  `),
  markTriageFailed: prepare(`
    UPDATE maintenance_requests SET status = 'triage_failed', updated_at = datetime('now') WHERE id = @id
  `),
  markDispatched: prepare(`
    UPDATE maintenance_requests SET status = 'dispatched', updated_at = datetime('now') WHERE id = @id
  `),
  markResolved: prepare(`
    UPDATE maintenance_requests SET status = 'resolved', updated_at = datetime('now') WHERE id = @id
  `),

  insertVendor: prepare(`INSERT INTO vendors (category, name, email) VALUES (@category, @name, @email)`),
  vendorsForCategory: prepare(`SELECT * FROM vendors WHERE category = ?`),
  listVendors: prepare(`SELECT * FROM vendors ORDER BY category ASC`),
};

module.exports = { propertyStatements };
