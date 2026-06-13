import express from "express";
import cors from "cors";
import Database from "better-sqlite3";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const db = new Database("wedding.db");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDistPath = path.resolve(__dirname, "../frontend/dist");
const port = process.env.PORT || 3001;
const rsvpEmailTo = process.env.RSVP_EMAIL_TO || "adrian.plapamaru@gmail.com";

app.use(cors());
app.use(express.json());

db.exec(`
  CREATE TABLE IF NOT EXISTS invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invite_key TEXT UNIQUE NOT NULL,
    guest_name TEXT NOT NULL,
    answer TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    answered_at TEXT
  );
`);

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
    .prepare("SELECT * FROM invitations WHERE invite_key = ?")
    .get(req.params.key);

  if (!row) {
    return res.status(404).json({ error: "Invitația nu există" });
  }

  res.json(row);
});

function createRsvpEmailSubmission({ inviteKey, guestName, answer }) {
  const accessKey = process.env.WEB3FORMS_ACCESS_KEY;

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

  const submission = createRsvpEmailSubmission({
    inviteKey: invite_key,
    guestName: invitation.guest_name,
    answer,
  });

  res.json({
    success: true,
    email: submission
      ? { provider: "web3forms", submission }
      : { provider: "web3forms", sent: false, reason: "missing_access_key" },
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
