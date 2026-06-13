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
    answered_at TEXT
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
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

function getInvitationById(id) {
  return db
    .prepare("SELECT id, invite_key, guest_name, answer, answered_at FROM invitations WHERE id = ?")
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
    .prepare("SELECT id, invite_key, guest_name, answer, answered_at FROM invitations WHERE invite_key = ?")
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
      `SELECT id, invite_key, guest_name, answer, answered_at
       FROM invitations
       ORDER BY id DESC`
    )
    .all();

  const summary = invitations.reduce(
    (totals, invitation) => {
      totals.total += 1;

      if (invitation.answer === "yes") {
        totals.yes += 1;
      } else if (invitation.answer === "no") {
        totals.no += 1;
      } else {
        totals.pending += 1;
      }

      return totals;
    },
    { total: 0, yes: 0, no: 0, pending: 0 }
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

  if (!guestName) {
    return res.status(400).json({ error: "Numele invitatului este obligatoriu" });
  }

  try {
    const result = db
      .prepare("INSERT INTO invitations (invite_key, guest_name, answer, answered_at) VALUES (?, ?, ?, ?)")
      .run(inviteKey, guestName, answer, answer ? new Date().toISOString() : null);

    res.status(201).json({ success: true, invitation: getInvitationById(result.lastInsertRowid) });
  } catch (error) {
    sendDatabaseError(res, error);
  }
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

  if (!guestName || !inviteKey) {
    return res.status(400).json({ error: "Numele și cheia sunt obligatorii" });
  }

  const answeredAt =
    answer && answer !== existing.answer ? new Date().toISOString() : answer ? existing.answered_at : null;

  try {
    db.prepare(
      `UPDATE invitations
       SET invite_key = ?, guest_name = ?, answer = ?, answered_at = ?
       WHERE id = ?`
    ).run(inviteKey, guestName, answer, answeredAt, id);

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

function createRsvpEmailSubmission({ req, inviteKey, guestName, answer }) {
  const accessKey = getWeb3FormsAccessKey(req);

  if (!accessKey) {
    return null;
  }

  const readableAnswer = answer === "yes" ? "Da, vin" : "Nu pot ajunge";

  return {
    access_key: accessKey,
    subject: `Raspuns invitatie nunta: ${guestName}`,
    from_name: "Small Wedding RSVP",
    recipient: rsvpEmailTo,
    name: guestName,
    message: [
      `Invitat: ${guestName}`,
      `Raspuns: ${readableAnswer}`,
      `Cheie invitatie: ${inviteKey}`,
      `Trimis la: ${new Date().toLocaleString("ro-RO", { timeZone: "Europe/Bucharest" })}`,
    ].join("\n"),
  };
}

app.post("/api/rsvp", async (req, res) => {
  const { invite_key, answer } = req.body;

  if (!invite_key || !["yes", "no"].includes(answer)) {
    return res.status(400).json({ error: "Răspuns invalid" });
  }

  const invitation = db
    .prepare("SELECT * FROM invitations WHERE invite_key = ?")
    .get(invite_key);

  if (!invitation) {
    return res.status(404).json({ error: "Invitația nu există" });
  }

  db.prepare(`
    UPDATE invitations
    SET answer = ?, answered_at = CURRENT_TIMESTAMP
    WHERE invite_key = ?
  `).run(answer, invite_key);

  const settings = getPublicSettings();
  const submission = settings.rsvp_email_enabled
    ? createRsvpEmailSubmission({
        req,
        inviteKey: invite_key,
        guestName: invitation.guest_name,
        answer,
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
