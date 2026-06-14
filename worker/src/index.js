const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS,
  });
}

async function readJson(request) {
  return request.json().catch(() => ({}));
}

function normalizeAnswer(answer) {
  return answer === "yes" || answer === "no" ? answer : null;
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

function generateInviteKey() {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);

  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function generateUniqueInviteKey(env) {
  let key = generateInviteKey();

  while (await env.DB.prepare("SELECT 1 FROM invitations WHERE invite_key = ?").bind(key).first()) {
    key = generateInviteKey();
  }

  return key;
}

async function getInvitationById(env, id) {
  return env.DB.prepare(
    `SELECT id, invite_key, guest_name, answer, party_size, accommodation_enabled,
            accommodation_requested, sort_order, answered_at
     FROM invitations
     WHERE id = ?`
  )
    .bind(id)
    .first();
}

function isUniqueConstraintError(error) {
  return String(error?.message || "").toLowerCase().includes("unique");
}

function databaseError(error) {
  if (isUniqueConstraintError(error)) {
    return json({ error: "Cheia invitației există deja" }, 409);
  }

  console.error(error);
  return json({ error: "A apărut o eroare" }, 500);
}

function isAdminRequest(request, env) {
  const providedToken = request.headers.get("x-admin-token");
  return Boolean(env.ADMIN_TOKEN && providedToken && providedToken === env.ADMIN_TOKEN);
}

async function getSetting(env, key) {
  const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key).first();
  return row?.value;
}

async function setSetting(env, key, value) {
  await env.DB.prepare(
    `INSERT INTO app_settings (key, value)
     VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  )
    .bind(key, value)
    .run();
}

async function getPublicSettings(env) {
  return {
    rsvp_email_enabled: (await getSetting(env, "rsvp_email_enabled")) !== "false",
  };
}

function getRequestHostname(request) {
  const origin = request.headers.get("origin") || request.headers.get("referer");

  if (origin) {
    try {
      return new URL(origin).hostname;
    } catch {
      return "";
    }
  }

  return new URL(request.url).hostname;
}

function getWeb3FormsAccessKey(request, env) {
  const hostname = getRequestHostname(request);

  if (hostname === "small-wedding.onrender.com") {
    return env.WEB3FORMS_ACCESS_KEY_RENDER || env.WEB3FORMS_ACCESS_KEY;
  }

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return env.WEB3FORMS_ACCESS_KEY_LOCAL || env.WEB3FORMS_ACCESS_KEY;
  }

  return env.WEB3FORMS_ACCESS_KEY_CLOUDFLARE || env.WEB3FORMS_ACCESS_KEY_RENDER || env.WEB3FORMS_ACCESS_KEY;
}

function createRsvpEmailSubmission({
  request,
  env,
  inviteKey,
  guestName,
  answer,
  partySize,
  accommodationEnabled,
  accommodationRequested,
}) {
  const accessKey = getWeb3FormsAccessKey(request, env);

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
    recipient: env.RSVP_EMAIL_TO || "adrian.plapamaru@gmail.com",
    name: guestName,
    message: [
      `Invitat: ${guestName}`,
      `Raspuns: ${readableAnswer}`,
      `Persoane: ${partySize}`,
      `Cazare disponibila pentru invitatie: ${accommodationEnabled ? "Da" : "Nu"}`,
      `Cazare solicitata: ${readableAccommodation}`,
      `Cheie invitatie: ${inviteKey}`,
      `Trimis la: ${new Date().toLocaleString("ro-RO", { timeZone: "Europe/Bucharest" })}`,
    ].join("\n"),
  };
}

async function getPublicInvitation(request, env, key) {
  const row = await env.DB.prepare(
    `SELECT id, invite_key, guest_name, answer, party_size, accommodation_enabled,
            accommodation_requested, sort_order, answered_at
     FROM invitations
     WHERE invite_key = ?`
  )
    .bind(key)
    .first();

  if (!row) {
    return json({ error: "Invitația nu există" }, 404);
  }

  return json(row);
}

async function getAdminInvitations(request, env) {
  if (!isAdminRequest(request, env)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const { results: invitations } = await env.DB.prepare(
    `SELECT id, invite_key, guest_name, answer, party_size, accommodation_enabled,
            accommodation_requested, sort_order, answered_at
     FROM invitations
     ORDER BY sort_order ASC, id ASC`
  ).all();

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

  return json({ summary, invitations });
}

async function createAdminInvitation(request, env) {
  if (!isAdminRequest(request, env)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const body = await readJson(request);
  const guestName = String(body.guest_name || "").trim();
  const inviteKey = String(body.invite_key || "").trim() || (await generateUniqueInviteKey(env));
  const answer = normalizeAnswer(body.answer);
  const partySize = normalizePartySize(body.party_size);
  const accommodationEnabled = normalizeBoolean(body.accommodation_enabled);
  const accommodationRequested = accommodationEnabled ? normalizeBoolean(body.accommodation_requested) : 0;
  const orderRow = await env.DB.prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM invitations").first();
  const sortOrder = orderRow?.next_order || 1;

  if (!guestName) {
    return json({ error: "Numele invitatului este obligatoriu" }, 400);
  }

  try {
    const result = await env.DB.prepare(
      `INSERT INTO invitations (
        invite_key, guest_name, answer, party_size, accommodation_enabled,
        accommodation_requested, sort_order, answered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        inviteKey,
        guestName,
        answer,
        partySize,
        accommodationEnabled,
        accommodationRequested,
        sortOrder,
        answer ? new Date().toISOString() : null
      )
      .run();

    return json({ success: true, invitation: await getInvitationById(env, result.meta.last_row_id) }, 201);
  } catch (error) {
    return databaseError(error);
  }
}

async function reorderAdminInvitations(request, env) {
  if (!isAdminRequest(request, env)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const body = await readJson(request);
  const ids = Array.isArray(body.ids) ? body.ids.map((id) => Number(id)).filter(Boolean) : [];

  if (!ids.length) {
    return json({ error: "Ordinea este invalidă" }, 400);
  }

  await env.DB.batch(
    ids.map((id, index) => env.DB.prepare("UPDATE invitations SET sort_order = ? WHERE id = ?").bind(index + 1, id))
  );

  return json({ success: true });
}

async function updateAdminInvitation(request, env, id) {
  if (!isAdminRequest(request, env)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const existing = await getInvitationById(env, id);

  if (!existing) {
    return json({ error: "Invitația nu există" }, 404);
  }

  const body = await readJson(request);
  const guestName = String(body.guest_name || "").trim();
  const inviteKey = String(body.invite_key || "").trim();
  const answer = normalizeAnswer(body.answer);
  const partySize = normalizePartySize(body.party_size);
  const accommodationEnabled = normalizeBoolean(body.accommodation_enabled);
  const accommodationRequested = accommodationEnabled ? normalizeBoolean(body.accommodation_requested) : 0;

  if (!guestName || !inviteKey) {
    return json({ error: "Numele și cheia sunt obligatorii" }, 400);
  }

  const answeredAt =
    answer && answer !== existing.answer ? new Date().toISOString() : answer ? existing.answered_at : null;

  try {
    await env.DB.prepare(
      `UPDATE invitations
       SET invite_key = ?, guest_name = ?, answer = ?, answered_at = ?, party_size = ?,
           accommodation_enabled = ?, accommodation_requested = ?
       WHERE id = ?`
    )
      .bind(inviteKey, guestName, answer, answeredAt, partySize, accommodationEnabled, accommodationRequested, id)
      .run();

    return json({ success: true, invitation: await getInvitationById(env, id) });
  } catch (error) {
    return databaseError(error);
  }
}

async function regenerateAdminInvitationKey(request, env, id) {
  if (!isAdminRequest(request, env)) {
    return json({ error: "Unauthorized" }, 401);
  }

  if (!(await getInvitationById(env, id))) {
    return json({ error: "Invitația nu există" }, 404);
  }

  const inviteKey = await generateUniqueInviteKey(env);
  await env.DB.prepare("UPDATE invitations SET invite_key = ? WHERE id = ?").bind(inviteKey, id).run();

  return json({ success: true, invitation: await getInvitationById(env, id) });
}

async function deleteAdminInvitation(request, env, id) {
  if (!isAdminRequest(request, env)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const result = await env.DB.prepare("DELETE FROM invitations WHERE id = ?").bind(id).run();

  if (result.meta.changes === 0) {
    return json({ error: "Invitația nu există" }, 404);
  }

  return json({ success: true });
}

async function getAdminSettings(request, env) {
  if (!isAdminRequest(request, env)) {
    return json({ error: "Unauthorized" }, 401);
  }

  return json({ settings: await getPublicSettings(env) });
}

async function updateAdminSettings(request, env) {
  if (!isAdminRequest(request, env)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const body = await readJson(request);
  await setSetting(env, "rsvp_email_enabled", body.rsvp_email_enabled ? "true" : "false");

  return json({ success: true, settings: await getPublicSettings(env) });
}

async function saveRsvp(request, env) {
  const body = await readJson(request);
  const { invite_key: inviteKey, answer } = body;
  const partySize = normalizePartySize(body.party_size);

  if (!inviteKey || !["yes", "no"].includes(answer)) {
    return json({ error: "Răspuns invalid" }, 400);
  }

  const invitation = await env.DB.prepare("SELECT * FROM invitations WHERE invite_key = ?").bind(inviteKey).first();

  if (!invitation) {
    return json({ error: "Invitația nu există" }, 404);
  }

  const accommodationRequested =
    answer === "yes" && invitation.accommodation_enabled ? normalizeBoolean(body.accommodation_requested) : 0;

  await env.DB.prepare(
    `UPDATE invitations
     SET answer = ?, party_size = ?, accommodation_requested = ?, answered_at = CURRENT_TIMESTAMP
     WHERE invite_key = ?`
  )
    .bind(answer, partySize, accommodationRequested, inviteKey)
    .run();

  const settings = await getPublicSettings(env);
  const submission = settings.rsvp_email_enabled
    ? createRsvpEmailSubmission({
        request,
        env,
        inviteKey,
        guestName: invitation.guest_name,
        answer,
        partySize,
        accommodationEnabled: Boolean(invitation.accommodation_enabled),
        accommodationRequested,
      })
    : null;

  return json({
    success: true,
    email: settings.rsvp_email_enabled
      ? submission
        ? { provider: "web3forms", submission }
        : { provider: "web3forms", sent: false, reason: "missing_access_key" }
      : { provider: "web3forms", sent: false, reason: "disabled" },
  });
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (method === "GET" && path.startsWith("/api/invitations/")) {
    return getPublicInvitation(request, env, decodeURIComponent(path.replace("/api/invitations/", "")));
  }

  if (method === "GET" && path === "/api/admin/invitations") {
    return getAdminInvitations(request, env);
  }

  if (method === "POST" && path === "/api/admin/invitations") {
    return createAdminInvitation(request, env);
  }

  if (method === "PUT" && path === "/api/admin/invitations/reorder") {
    return reorderAdminInvitations(request, env);
  }

  const regenerateMatch = path.match(/^\/api\/admin\/invitations\/(\d+)\/regenerate-key$/);
  if (regenerateMatch && method === "POST") {
    return regenerateAdminInvitationKey(request, env, Number(regenerateMatch[1]));
  }

  const invitationMatch = path.match(/^\/api\/admin\/invitations\/(\d+)$/);
  if (invitationMatch && method === "PUT") {
    return updateAdminInvitation(request, env, Number(invitationMatch[1]));
  }

  if (invitationMatch && method === "DELETE") {
    return deleteAdminInvitation(request, env, Number(invitationMatch[1]));
  }

  if (method === "GET" && path === "/api/admin/settings") {
    return getAdminSettings(request, env);
  }

  if (method === "PUT" && path === "/api/admin/settings") {
    return updateAdminSettings(request, env);
  }

  if (method === "POST" && path === "/api/rsvp") {
    return saveRsvp(request, env);
  }

  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
