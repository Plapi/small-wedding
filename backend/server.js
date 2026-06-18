import express from "express";
import cors from "cors";
import Database from "better-sqlite3";
import dotenv from "dotenv";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const db = new Database("wedding.db");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDistPath = path.resolve(__dirname, "../frontend/dist");
const port = process.env.PORT || 3001;
const rsvpEmailTo = process.env.RSVP_EMAIL_TO || "adrian.plapamaru@gmail.com";
const localWeb3FormsKey =
  process.env.WEB3FORMS_ACCESS_KEY_LOCAL || process.env.WEB3FORMS_ACCESS_KEY;
const renderWeb3FormsKey =
  process.env.WEB3FORMS_ACCESS_KEY_RENDER || process.env.WEB3FORMS_ACCESS_KEY;
const adminToken = process.env.ADMIN_TOKEN;

app.use(cors());
app.use(express.json());

db.exec(`
  CREATE TABLE IF NOT EXISTS invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invite_key TEXT UNIQUE NOT NULL,
    guest_name TEXT NOT NULL,
    answer TEXT,
    party_size INTEGER NOT NULL DEFAULT 1,
    accommodation_enabled INTEGER NOT NULL DEFAULT 0,
    accommodation_requested INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    answered_at TEXT
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS dining_tables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    capacity INTEGER NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS table_assignments (
    invitation_id INTEGER PRIMARY KEY,
    table_id INTEGER NOT NULL,
    FOREIGN KEY (invitation_id) REFERENCES invitations(id) ON DELETE CASCADE,
    FOREIGN KEY (table_id) REFERENCES dining_tables(id) ON DELETE CASCADE
  );
`);

db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)").run(
  "rsvp_email_enabled",
  "true"
);

const invitationColumns = db.prepare("PRAGMA table_info(invitations)").all();

if (invitationColumns.some((column) => column.name === "created_at")) {
  db.exec("ALTER TABLE invitations DROP COLUMN created_at");
}

if (!invitationColumns.some((column) => column.name === "party_size")) {
  db.exec("ALTER TABLE invitations ADD COLUMN party_size INTEGER NOT NULL DEFAULT 1");
}

if (!invitationColumns.some((column) => column.name === "accommodation_enabled")) {
  db.exec("ALTER TABLE invitations ADD COLUMN accommodation_enabled INTEGER NOT NULL DEFAULT 0");
}

if (!invitationColumns.some((column) => column.name === "accommodation_requested")) {
  db.exec("ALTER TABLE invitations ADD COLUMN accommodation_requested INTEGER NOT NULL DEFAULT 0");
}

if (!invitationColumns.some((column) => column.name === "notes")) {
  db.exec("ALTER TABLE invitations ADD COLUMN notes TEXT NOT NULL DEFAULT ''");
}

if (invitationColumns.some((column) => column.name === "room_count")) {
  db.exec("ALTER TABLE invitations DROP COLUMN room_count");
}

if (!invitationColumns.some((column) => column.name === "sort_order")) {
  db.exec("ALTER TABLE invitations ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
  db.exec("UPDATE invitations SET sort_order = id WHERE sort_order = 0");
}

function generateInviteKey() {
  return crypto.randomBytes(9).toString("base64url");
}

function generateUniqueInviteKey() {
  let key = generateInviteKey();

  while (db.prepare("SELECT 1 FROM invitations WHERE invite_key = ?").get(key)) {
    key = generateInviteKey();
  }

  return key;
}

function normalizeAnswer(answer) {
  if (answer === "yes" || answer === "no") {
    return answer;
  }

  return null;
}

function normalizePartySize(partySize) {
  const parsed = Number.parseInt(partySize, 10);

  if (Number.isNaN(parsed)) {
    return 1;
  }

  return Math.min(Math.max(parsed, 1), 20);
}

function normalizeBoolean(value) {
  return value === true || value === "true" || value === "on" || value === 1 || value === "1" ? 1 : 0;
}

function normalizeNotes(value) {
  return String(value || "").trim().slice(0, 1000);
}

function normalizeTableCapacity(capacity) {
  const parsed = Number.parseInt(capacity, 10);

  if (Number.isNaN(parsed)) {
    return 2;
  }

  return Math.min(Math.max(parsed, 2), 20);
}

function getInvitationById(id) {
  return db
    .prepare(
      `SELECT id, invite_key, guest_name, answer, party_size, accommodation_enabled,
              accommodation_requested, notes, sort_order, answered_at
       FROM invitations
       WHERE id = ?`
    )
    .get(id);
}

function sendDatabaseError(res, error) {
  if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
    return res.status(409).json({ error: "Cheia invitației există deja" });
  }

  console.error(error);
  return res.status(500).json({ error: "A apărut o eroare" });
}

function getSetting(key) {
  return db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key)?.value;
}

function setSetting(key, value) {
  db.prepare(
    `INSERT INTO app_settings (key, value)
     VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}

function getPublicSettings() {
  return {
    rsvp_email_enabled: getSetting("rsvp_email_enabled") !== "false",
  };
}

app.post("/api/invitations", (req, res) => {
  const { invite_key, guest_name } = req.body;

  const stmt = db.prepare(`
    INSERT INTO invitations (invite_key, guest_name)
    VALUES (?, ?)
  `);

  stmt.run(invite_key, guest_name);

  res.json({ success: true });
});

app.get("/api/invitations/:key", (req, res) => {
  const row = db
    .prepare(
      `SELECT id, invite_key, guest_name, answer, party_size, accommodation_enabled,
              accommodation_requested, notes, sort_order, answered_at
       FROM invitations
       WHERE invite_key = ?`
    )
    .get(req.params.key);

  if (!row) {
    return res.status(404).json({ error: "Invitația nu există" });
  }

  res.json(row);
});

function isAdminRequest(req) {
  const providedToken = req.get("x-admin-token");
  return Boolean(adminToken && providedToken && providedToken === adminToken);
}

app.get("/api/admin/invitations", (req, res) => {
  if (!isAdminRequest(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const invitations = db
    .prepare(
      `SELECT id, invite_key, guest_name, answer, party_size, accommodation_enabled,
              accommodation_requested, notes, sort_order, answered_at
       FROM invitations
       ORDER BY sort_order ASC, id ASC`
    )
    .all();

  const summary = invitations.reduce(
    (totals, invitation) => {
      totals.total += 1;

      if (invitation.answer === "yes") {
        totals.yes += 1;
        totals.guests += invitation.party_size;

        if (invitation.accommodation_requested) {
          totals.accommodation += 1;
        }
      } else if (invitation.answer === "no") {
        totals.no += 1;
      } else {
        totals.pending += 1;
      }

      return totals;
    },
    { total: 0, yes: 0, no: 0, pending: 0, guests: 0, accommodation: 0 }
  );

  res.json({ summary, invitations });
});

app.post("/api/admin/invitations", (req, res) => {
  if (!isAdminRequest(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const guestName = String(req.body.guest_name || "").trim();
  const inviteKey = String(req.body.invite_key || "").trim() || generateUniqueInviteKey();
  const answer = normalizeAnswer(req.body.answer);
  const partySize = normalizePartySize(req.body.party_size);
  const accommodationEnabled = normalizeBoolean(req.body.accommodation_enabled);
  const accommodationRequested = accommodationEnabled ? normalizeBoolean(req.body.accommodation_requested) : 0;
  const notes = answer === "yes" ? normalizeNotes(req.body.notes) : "";
  const sortOrder = db.prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM invitations").get()
    .next_order;

  if (!guestName) {
    return res.status(400).json({ error: "Numele invitatului este obligatoriu" });
  }

  try {
    const result = db
      .prepare(
        `INSERT INTO invitations (
          invite_key, guest_name, answer, party_size, accommodation_enabled,
          accommodation_requested, notes, sort_order, answered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        inviteKey,
        guestName,
        answer,
        partySize,
        accommodationEnabled,
        accommodationRequested,
        notes,
        sortOrder,
        answer ? new Date().toISOString() : null
      );

    res.status(201).json({ success: true, invitation: getInvitationById(result.lastInsertRowid) });
  } catch (error) {
    sendDatabaseError(res, error);
  }
});

app.put("/api/admin/invitations/reorder", (req, res) => {
  if (!isAdminRequest(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const ids = Array.isArray(req.body.ids) ? req.body.ids.map((id) => Number(id)).filter(Boolean) : [];

  if (!ids.length) {
    return res.status(400).json({ error: "Ordinea este invalidă" });
  }

  const updateOrder = db.prepare("UPDATE invitations SET sort_order = ? WHERE id = ?");
  const saveOrder = db.transaction((orderedIds) => {
    orderedIds.forEach((id, index) => {
      updateOrder.run(index + 1, id);
    });
  });

  saveOrder(ids);

  res.json({ success: true });
});

app.put("/api/admin/invitations/:id", (req, res) => {
  if (!isAdminRequest(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const id = Number(req.params.id);
  const existing = getInvitationById(id);

  if (!existing) {
    return res.status(404).json({ error: "Invitația nu există" });
  }

  const guestName = String(req.body.guest_name || "").trim();
  const inviteKey = String(req.body.invite_key || "").trim();
  const answer = normalizeAnswer(req.body.answer);
  const partySize = normalizePartySize(req.body.party_size);
  const accommodationEnabled = normalizeBoolean(req.body.accommodation_enabled);
  const accommodationRequested = accommodationEnabled ? normalizeBoolean(req.body.accommodation_requested) : 0;
  const notes = answer === "yes" ? normalizeNotes(req.body.notes) : "";

  if (!guestName || !inviteKey) {
    return res.status(400).json({ error: "Numele și cheia sunt obligatorii" });
  }

  const answeredAt =
    answer && answer !== existing.answer ? new Date().toISOString() : answer ? existing.answered_at : null;

  try {
    db.prepare(
      `UPDATE invitations
       SET invite_key = ?, guest_name = ?, answer = ?, answered_at = ?, party_size = ?,
           accommodation_enabled = ?, accommodation_requested = ?, notes = ?
       WHERE id = ?`
    ).run(
      inviteKey,
      guestName,
      answer,
      answeredAt,
      partySize,
      accommodationEnabled,
      accommodationRequested,
      notes,
      id
    );

    res.json({ success: true, invitation: getInvitationById(id) });
  } catch (error) {
    sendDatabaseError(res, error);
  }
});

app.post("/api/admin/invitations/:id/regenerate-key", (req, res) => {
  if (!isAdminRequest(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const id = Number(req.params.id);

  if (!getInvitationById(id)) {
    return res.status(404).json({ error: "Invitația nu există" });
  }

  const inviteKey = generateUniqueInviteKey();
  db.prepare("UPDATE invitations SET invite_key = ? WHERE id = ?").run(inviteKey, id);

  res.json({ success: true, invitation: getInvitationById(id) });
});

app.delete("/api/admin/invitations/:id", (req, res) => {
  if (!isAdminRequest(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const result = db.prepare("DELETE FROM invitations WHERE id = ?").run(req.params.id);

  if (result.changes === 0) {
    return res.status(404).json({ error: "Invitația nu există" });
  }

  res.json({ success: true });
});

function getSeatingData() {
  const guests = db
    .prepare(
      `SELECT invitations.id, invitations.guest_name, invitations.party_size,
              invitations.accommodation_requested, invitations.notes,
              table_assignments.table_id
       FROM invitations
       LEFT JOIN table_assignments ON table_assignments.invitation_id = invitations.id
       WHERE invitations.answer = 'yes'
       ORDER BY invitations.sort_order ASC, invitations.id ASC`
    )
    .all();
  const tables = db
    .prepare(
      `SELECT id, name, capacity, sort_order
       FROM dining_tables
       ORDER BY sort_order ASC, id ASC`
    )
    .all();

  return { guests, tables };
}

function getTableOccupancy(tableId, excludedInvitationId = null) {
  return db
    .prepare(
      `SELECT COALESCE(SUM(invitations.party_size), 0) AS occupied
       FROM table_assignments
       JOIN invitations ON invitations.id = table_assignments.invitation_id
       WHERE table_assignments.table_id = ?
         AND (? IS NULL OR table_assignments.invitation_id != ?)`
    )
    .get(tableId, excludedInvitationId, excludedInvitationId).occupied;
}

app.get("/api/admin/seating", (req, res) => {
  if (!isAdminRequest(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  res.json(getSeatingData());
});

app.post("/api/admin/tables", (req, res) => {
  if (!isAdminRequest(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const name = String(req.body.name || "").trim();
  const capacity = normalizeTableCapacity(req.body.capacity);
  const sortOrder = db.prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM dining_tables").get()
    .next_order;

  if (!name) {
    return res.status(400).json({ error: "Numele mesei este obligatoriu" });
  }

  const result = db
    .prepare("INSERT INTO dining_tables (name, capacity, sort_order) VALUES (?, ?, ?)")
    .run(name, capacity, sortOrder);
  const table = db.prepare("SELECT id, name, capacity, sort_order FROM dining_tables WHERE id = ?").get(result.lastInsertRowid);

  res.status(201).json({ success: true, table });
});

app.put("/api/admin/tables/:id", (req, res) => {
  if (!isAdminRequest(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const id = Number(req.params.id);
  const name = String(req.body.name || "").trim();
  const capacity = normalizeTableCapacity(req.body.capacity);
  const occupied = getTableOccupancy(id);

  if (!name) {
    return res.status(400).json({ error: "Numele mesei este obligatoriu" });
  }

  if (capacity < occupied) {
    return res.status(400).json({ error: `Masa are deja ${occupied} persoane repartizate.` });
  }

  const result = db.prepare("UPDATE dining_tables SET name = ?, capacity = ? WHERE id = ?").run(name, capacity, id);

  if (result.changes === 0) {
    return res.status(404).json({ error: "Masa nu există" });
  }

  res.json({ success: true });
});

app.delete("/api/admin/tables/:id", (req, res) => {
  if (!isAdminRequest(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const id = Number(req.params.id);
  const removeAssignments = db.prepare("DELETE FROM table_assignments WHERE table_id = ?");
  const removeTable = db.prepare("DELETE FROM dining_tables WHERE id = ?");
  const remove = db.transaction(() => {
    removeAssignments.run(id);
    return removeTable.run(id);
  });
  const result = remove();

  if (result.changes === 0) {
    return res.status(404).json({ error: "Masa nu există" });
  }

  res.json({ success: true });
});

app.put("/api/admin/seating/assignments", (req, res) => {
  if (!isAdminRequest(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const invitationId = Number(req.body.invitation_id);
  const tableId = req.body.table_id ? Number(req.body.table_id) : null;
  const invitation = db
    .prepare("SELECT id, party_size FROM invitations WHERE id = ? AND answer = 'yes'")
    .get(invitationId);

  if (!invitation) {
    return res.status(404).json({ error: "Invitatul confirmat nu există" });
  }

  if (!tableId) {
    db.prepare("DELETE FROM table_assignments WHERE invitation_id = ?").run(invitationId);
    return res.json({ success: true });
  }

  const table = db.prepare("SELECT id, capacity FROM dining_tables WHERE id = ?").get(tableId);

  if (!table) {
    return res.status(404).json({ error: "Masa nu există" });
  }

  const occupied = getTableOccupancy(tableId, invitationId);

  if (occupied + invitation.party_size > table.capacity) {
    return res.status(400).json({ error: "Nu mai sunt suficiente locuri la această masă." });
  }

  db.prepare(
    `INSERT INTO table_assignments (invitation_id, table_id)
     VALUES (?, ?)
     ON CONFLICT(invitation_id) DO UPDATE SET table_id = excluded.table_id`
  ).run(invitationId, tableId);

  res.json({ success: true });
});

app.get("/api/admin/settings", (req, res) => {
  if (!isAdminRequest(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  res.json({ settings: getPublicSettings() });
});

app.put("/api/admin/settings", (req, res) => {
  if (!isAdminRequest(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  setSetting("rsvp_email_enabled", req.body.rsvp_email_enabled ? "true" : "false");

  res.json({ success: true, settings: getPublicSettings() });
});

function getRequestHostname(req) {
  const origin = req.get("origin") || req.get("referer");

  if (origin) {
    try {
      return new URL(origin).hostname;
    } catch {
      return "";
    }
  }

  return req.hostname;
}

function getWeb3FormsAccessKey(req) {
  const hostname = getRequestHostname(req);

  if (hostname === "small-wedding.onrender.com") {
    return renderWeb3FormsKey;
  }

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return localWeb3FormsKey;
  }

  return renderWeb3FormsKey || localWeb3FormsKey;
}

function createRsvpEmailSubmission({
  req,
  inviteKey,
  guestName,
  answer,
  partySize,
  accommodationEnabled,
  accommodationRequested,
  notes,
}) {
  const accessKey = getWeb3FormsAccessKey(req);

  if (!accessKey) {
    return null;
  }

  const readableAnswer = answer === "yes" ? "Da, vin" : "Nu pot ajunge";
  const readableAccommodation =
    answer === "yes" && accommodationEnabled ? (accommodationRequested ? "Da" : "Nu") : "Nu se aplică";

  return {
    access_key: accessKey,
    subject: `Raspuns invitatie cununie: ${guestName}`,
    from_name: "Small Wedding RSVP",
    recipient: rsvpEmailTo,
    name: guestName,
    message: [
      `Invitat: ${guestName}`,
      `Raspuns: ${readableAnswer}`,
      `Persoane: ${partySize}`,
      `Cazare disponibila pentru invitatie: ${accommodationEnabled ? "Da" : "Nu"}`,
      `Cazare solicitata: ${readableAccommodation}`,
      `Mentiuni: ${notes || "Nu sunt"}`,
      `Cheie invitatie: ${inviteKey}`,
      `Trimis la: ${new Date().toLocaleString("ro-RO", { timeZone: "Europe/Bucharest" })}`,
    ].join("\n"),
  };
}

app.post("/api/rsvp", async (req, res) => {
  const { invite_key, answer } = req.body;
  const partySize = normalizePartySize(req.body.party_size);
  const notes = answer === "yes" ? normalizeNotes(req.body.notes) : "";

  if (!invite_key || !["yes", "no"].includes(answer)) {
    return res.status(400).json({ error: "Răspuns invalid" });
  }

  const invitation = db
    .prepare("SELECT * FROM invitations WHERE invite_key = ?")
    .get(invite_key);

  if (!invitation) {
    return res.status(404).json({ error: "Invitația nu există" });
  }

  const accommodationRequested =
    answer === "yes" && invitation.accommodation_enabled ? normalizeBoolean(req.body.accommodation_requested) : 0;

  db.prepare(`
    UPDATE invitations
    SET answer = ?, party_size = ?, accommodation_requested = ?, notes = ?, answered_at = CURRENT_TIMESTAMP
    WHERE invite_key = ?
  `).run(answer, partySize, accommodationRequested, notes, invite_key);

  const settings = getPublicSettings();
  const submission = settings.rsvp_email_enabled
    ? createRsvpEmailSubmission({
        req,
        inviteKey: invite_key,
        guestName: invitation.guest_name,
        answer,
        partySize,
        accommodationEnabled: Boolean(invitation.accommodation_enabled),
        accommodationRequested,
        notes,
      })
    : null;

  res.json({
    success: true,
    email: settings.rsvp_email_enabled
      ? submission
        ? { provider: "web3forms", submission }
        : { provider: "web3forms", sent: false, reason: "missing_access_key" }
      : { provider: "web3forms", sent: false, reason: "disabled" },
  });
});

app.use(express.static(frontendDistPath));

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(frontendDistPath, "index.html"));
});

const server = app.listen(port, () => {
  console.log(`Backend running on port ${port}`);
});

process.on("SIGTERM", () => {
  server.close(() => {
    process.exit(0);
  });
});
