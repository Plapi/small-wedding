import express from "express";
import cors from "cors";
import Database from "better-sqlite3";

const app = express();
const db = new Database("wedding.db");

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

app.post("/api/rsvp", (req, res) => {
  const { invite_key, answer } = req.body;

  db.prepare(`
    UPDATE invitations
    SET answer = ?, answered_at = CURRENT_TIMESTAMP
    WHERE invite_key = ?
  `).run(answer, invite_key);

  // Mai târziu aici adaugi trimiterea emailului

  res.json({ success: true });
});

app.listen(3001, () => {
  console.log("Backend running on http://localhost:3001");
});