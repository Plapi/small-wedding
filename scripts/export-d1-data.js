import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = resolve(rootDir, "backend/wedding.db");
const outputPath = resolve(rootDir, "d1/seed.sql");

function query(sql) {
  const output = execFileSync("sqlite3", [dbPath, "-json", sql], {
    encoding: "utf8",
  });

  return JSON.parse(output || "[]");
}

function sqlValue(value) {
  if (value === null || value === undefined) {
    return "NULL";
  }

  if (typeof value === "number") {
    return String(value);
  }

  return `'${String(value).replaceAll("'", "''")}'`;
}

const invitations = query(`
  SELECT id, invite_key, guest_name, answer, party_size, accommodation_enabled,
         accommodation_requested, notes, sort_order, answered_at
  FROM invitations
  ORDER BY sort_order ASC, id ASC
`);

const settings = query("SELECT key, value FROM app_settings ORDER BY key ASC");

const lines = [
  "-- Generated with: npm run d1:export",
  "-- Apply once with: npx wrangler d1 execute small-wedding-db --remote --file d1/seed.sql",
  "",
  "DELETE FROM invitations;",
  "DELETE FROM app_settings;",
  "",
];

for (const invitation of invitations) {
  lines.push(
      `INSERT INTO invitations (` +
      `id, invite_key, guest_name, answer, party_size, accommodation_enabled, accommodation_requested, notes, sort_order, answered_at` +
      `) VALUES (` +
      [
        invitation.id,
        invitation.invite_key,
        invitation.guest_name,
        invitation.answer,
        invitation.party_size,
        invitation.accommodation_enabled,
        invitation.accommodation_requested,
        invitation.notes,
        invitation.sort_order,
        invitation.answered_at,
      ]
        .map(sqlValue)
        .join(", ") +
      `);`
  );
}

lines.push("");

for (const setting of settings) {
  lines.push(`INSERT INTO app_settings (key, value) VALUES (${sqlValue(setting.key)}, ${sqlValue(setting.value)});`);
}

lines.push("");

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, lines.join("\n"), "utf8");

console.log(`Exported ${invitations.length} invitations and ${settings.length} settings to ${outputPath}`);
