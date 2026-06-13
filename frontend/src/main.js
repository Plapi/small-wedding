import "./style.css";

const API_URL = import.meta.env.VITE_API_URL || "/api";
const ADMIN_TOKEN_STORAGE_KEY = "small-wedding-admin-token";

const params = new URLSearchParams(window.location.search);
const inviteKey = params.get("key");
const app = document.querySelector("#app");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatAnswer(answer) {
  if (answer === "yes") {
    return "Da";
  }

  if (answer === "no") {
    return "Nu";
  }

  return "Fără răspuns";
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  const date = value.includes("T") ? new Date(value) : new Date(`${value}Z`);

  return date.toLocaleString("ro-RO", {
    timeZone: "Europe/Bucharest",
  });
}

function renderPartySizeOptions(selectedValue = 1) {
  return Array.from({ length: 10 }, (_, index) => index + 1)
    .map((value) => `<option value="${value}" ${Number(selectedValue) === value ? "selected" : ""}>${value}</option>`)
    .join("");
}

function adminHeaders() {
  return {
    "Content-Type": "application/json",
    "x-admin-token": sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY),
  };
}

function getInvitationUrl(inviteKey) {
  return `${window.location.origin}/?key=${encodeURIComponent(inviteKey)}`;
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

async function adminRequest(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...adminHeaders(),
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Operațiunea nu a reușit.");
  }

  return data;
}

function renderInvitationPage(invitation) {
  app.innerHTML = `
    <main class="invite-page">
      <section class="invite-card" aria-labelledby="inviteTitle">
        <p class="eyebrow">Vama Veche · Sandalandala</p>
        <h1 id="inviteTitle">Invitație Cununie în Vamă</h1>
        <h2>Adrian & Liliana</h2>

        <div class="guest-note">
          <p>Bună, ${escapeHtml(invitation.guest_name)}!</p>
          <p>Ne-ar bucura să fii alături de noi, cu nisip sub tălpi și mare aproape.</p>
        </div>

        <form id="rsvpForm" class="rsvp-form">
          <fieldset>
            <legend>Vii la cununia noastră?</legend>

            <label class="rsvp-option">
              <input type="radio" name="answer" value="yes" />
              <span>
                <strong>Da, vin</strong>
                <small>Abia aștept să sărbătorim împreună.</small>
              </span>
            </label>

            <label class="rsvp-option">
              <input type="radio" name="answer" value="no" />
              <span>
                <strong>Nu pot ajunge</strong>
                <small>Vă trimit gânduri bune de departe.</small>
              </span>
            </label>
          </fieldset>

          <label id="partySizeField" class="party-size-field" hidden>
            <span>Câte persoane veți fi în total?</span>
            <select id="partySize" name="party_size">
              ${renderPartySizeOptions(invitation.party_size)}
            </select>
          </label>

          ${
            invitation.accommodation_enabled
              ? `
                <div id="accommodationSection" class="accommodation-section" hidden>
                  <p>Doriți să vă căutăm cazare?</p>
                  <div class="segmented-options">
                    <label>
                      <input type="radio" name="accommodation_requested" value="true" />
                      <span>Da</span>
                    </label>
                    <label>
                      <input type="radio" name="accommodation_requested" value="false" />
                      <span>Nu</span>
                    </label>
                  </div>
                </div>
              `
              : ""
          }

          <button id="submitBtn" class="submit-btn" type="submit" disabled>Trimite răspunsul</button>
          <p id="status" class="status" role="status" aria-live="polite"></p>
        </form>
      </section>
    </main>
  `;

  const form = document.querySelector("#rsvpForm");
  const submitBtn = document.querySelector("#submitBtn");

  form.onchange = () => {
    const answer = new FormData(form).get("answer");
    const partySizeField = document.querySelector("#partySizeField");
    const partySizeSelect = document.querySelector("#partySize");
    const accommodationSection = document.querySelector("#accommodationSection");

    partySizeField.hidden = answer !== "yes";
    partySizeSelect.disabled = answer !== "yes";
    if (accommodationSection) {
      accommodationSection.hidden = answer !== "yes";
    }
    submitBtn.disabled = !answer;
  };

  form.onsubmit = async (event) => {
    event.preventDefault();
    const answer = new FormData(form).get("answer");

    if (!answer) {
      return;
    }

    await sendAnswer(answer);
  };
}

async function loadInvitation() {
  if (!inviteKey) {
    app.innerHTML = '<main class="invite-page">Lipsește cheia invitației.</main>';
    return;
  }

  const response = await fetch(`${API_URL}/invitations/${inviteKey}`);

  if (!response.ok) {
    app.innerHTML = '<main class="invite-page">Invitația nu există.</main>';
    return;
  }

  const invitation = await response.json();
  renderInvitationPage(invitation);
}

async function sendAnswer(answer) {
  const form = document.querySelector("#rsvpForm");
  const submitBtn = document.querySelector("#submitBtn");
  const status = document.querySelector("#status");

  form.classList.add("is-submitting");
  submitBtn.disabled = true;
  submitBtn.textContent = "Se trimite...";
  status.className = "status";
  status.textContent = "";

  const response = await fetch(`${API_URL}/rsvp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      invite_key: inviteKey,
      answer,
      party_size: answer === "yes" ? new FormData(form).get("party_size") : 1,
      accommodation_requested:
        answer === "yes" ? new FormData(form).get("accommodation_requested") === "true" : false,
    }),
  });

  const result = await response.json();

  if (!response.ok || !result.success) {
    form.classList.remove("is-submitting");
    submitBtn.disabled = false;
    submitBtn.textContent = "Trimite răspunsul";
    status.className = "status status-error";
    status.textContent = "Răspunsul nu a putut fi trimis.";
    return;
  }

  if (result.email?.provider === "web3forms" && result.email.submission) {
    try {
      const emailResponse = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(result.email.submission),
      });

      const emailResult = await emailResponse.json().catch(() => ({}));

      if (!emailResponse.ok || emailResult.success === false) {
        throw new Error(emailResult.message || "Emailul nu a putut fi trimis.");
      }
    } catch (error) {
      console.error(error);
      form.classList.remove("is-submitting");
      submitBtn.disabled = false;
      submitBtn.textContent = "Trimite răspunsul";
      status.className = "status status-error";
      status.textContent = "Răspunsul a fost salvat, dar emailul nu a putut fi trimis.";
      return;
    }
  }

  form.classList.remove("is-submitting");
  form.classList.add("is-complete");
  submitBtn.textContent = "Trimis";
  status.className = "status status-success";
  status.textContent = "Răspunsul a fost trimis. Mulțumim!";
}

function renderAdminLogin(message = "") {
  app.innerHTML = `
    <main class="admin-page">
      <section class="admin-header">
        <div>
          <h1>Invitații</h1>
          <p>Panou privat pentru răspunsurile la cununie.</p>
        </div>
      </section>

      <form id="adminLogin" class="admin-login">
        <label for="adminToken">Token admin</label>
        <input id="adminToken" name="adminToken" type="password" autocomplete="current-password" required />
        <button type="submit">Vezi invitațiile</button>
        <p class="status">${escapeHtml(message)}</p>
      </form>
    </main>
  `;

  document.querySelector("#adminLogin").onsubmit = async (event) => {
    event.preventDefault();
    const token = new FormData(event.currentTarget).get("adminToken");
    sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
    await loadAdminPage();
  };
}

function renderAdminDashboard({ summary, invitations }, settings) {
  const cards = invitations
    .map(
      (invitation) => `
        <article class="invitation-card" data-id="${invitation.id}" draggable="true">
          <header class="invitation-card-header">
            <button class="drag-handle" type="button" aria-label="Mută invitația">Mută</button>
            <div>
              <h3>${escapeHtml(invitation.guest_name)}</h3>
              <p>${formatAnswer(invitation.answer)} · ${invitation.party_size || 1} persoane</p>
            </div>
          </header>

          <div class="invitation-card-grid">
            <label>
              Nume invitat
              <input class="table-input" name="guest_name" value="${escapeHtml(invitation.guest_name)}" />
            </label>

            <label class="wide-field">
              Cheie invitație
              <div class="key-cell">
                <input class="table-input key-input" name="invite_key" value="${escapeHtml(invitation.invite_key)}" />
                <button class="ghost-btn regenerate-btn" type="button">Regenerează</button>
                <button class="ghost-btn copy-link-btn" type="button">Copiază link</button>
              </div>
            </label>

            <label>
              Răspuns
              <select class="table-input" name="answer">
              <option value="" ${!invitation.answer ? "selected" : ""}>Fără răspuns</option>
              <option value="yes" ${invitation.answer === "yes" ? "selected" : ""}>Da</option>
              <option value="no" ${invitation.answer === "no" ? "selected" : ""}>Nu</option>
              </select>
            </label>

            <label>
              Persoane
              <input class="table-input party-size-input" name="party_size" type="number" min="1" max="20" value="${escapeHtml(invitation.party_size || 1)}" />
            </label>

            <label class="table-check">
              <input name="accommodation_enabled" type="checkbox" ${invitation.accommodation_enabled ? "checked" : ""} />
              <span>Cazare disponibilă</span>
            </label>

            <label>
              Cere cazare
              <select class="table-input" name="accommodation_requested">
              <option value="false" ${!invitation.accommodation_requested ? "selected" : ""}>Nu</option>
              <option value="true" ${invitation.accommodation_requested ? "selected" : ""}>Da</option>
              </select>
            </label>
          </div>

          <footer class="invitation-card-footer">
            <span>Răspuns la: ${formatDate(invitation.answered_at)}</span>
            <div class="row-actions">
              <button class="save-row-btn" type="button">Salvează</button>
              <button class="danger-btn delete-row-btn" type="button">Șterge</button>
            </div>
          </footer>
        </article>
      `
    )
    .join("");

  app.innerHTML = `
    <main class="admin-page">
      <section class="admin-header">
        <div>
          <h1>Invitații</h1>
          <p>Răspunsurile primite pentru Adrian & Liliana.</p>
        </div>
        <button id="logoutBtn" type="button">Ieșire</button>
      </section>

      <section class="summary-grid" aria-label="Rezumat invitații">
        <div class="summary-card summary-total"><strong>${summary.total}</strong><span>Total</span></div>
        <div class="summary-card summary-yes"><strong>${summary.yes}</strong><span>Vin</span></div>
        <div class="summary-card summary-guests"><strong>${summary.guests}</strong><span>Persoane vin</span></div>
        <div class="summary-card summary-no"><strong>${summary.no}</strong><span>Nu vin</span></div>
        <div class="summary-card summary-pending"><strong>${summary.pending}</strong><span>Fără răspuns</span></div>
        <div class="summary-card summary-accommodation"><strong>${summary.accommodation}</strong><span>Cazare</span></div>
      </section>

      <form id="addInvitationForm" class="admin-panel">
        <h2>Adaugă invitație</h2>
        <div class="admin-form-grid">
          <label>
            Nume invitat
            <input name="guest_name" required placeholder="Ex: Andrei Popescu" />
          </label>
          <label class="wide-field">
            Cheie invitație
            <input name="invite_key" placeholder="Se generează automat dacă rămâne gol" />
          </label>
          <label>
            Răspuns
            <select name="answer">
              <option value="">Fără răspuns</option>
              <option value="yes">Da</option>
              <option value="no">Nu</option>
            </select>
          </label>
          <label>
            Persoane
            <input name="party_size" type="number" min="1" max="20" value="1" />
          </label>
          <label class="admin-checkbox-label">
            <span>Cazare disponibilă</span>
            <input name="accommodation_enabled" type="checkbox" />
          </label>
        </div>
        <div class="admin-panel-actions">
          <button type="submit">Adaugă invitația</button>
        </div>
        <p id="adminStatus" class="status" role="status" aria-live="polite"></p>
      </form>

      <section>
        <div class="admin-list-header">
          <h2>Lista invitațiilor</h2>
          <p>Trage cardurile pentru a schimba ordinea.</p>
        </div>
        <div id="invitationList" class="invitation-list">
          ${cards || '<p class="empty-state">Nu există invitații încă.</p>'}
        </div>
      </section>

      <section class="admin-panel admin-settings-panel">
        <div>
          <h2>Setări</h2>
          <p>Controlează opțiunile globale ale proiectului.</p>
        </div>

        <label class="setting-toggle">
          <input id="emailEnabledToggle" type="checkbox" ${settings.rsvp_email_enabled ? "checked" : ""} />
          <span>
            <strong>Trimite email la RSVP</strong>
            <small>Când este dezactivat, răspunsurile se salvează în baza de date, dar nu se trimite email.</small>
          </span>
        </label>
        <p id="settingsStatus" class="status" role="status" aria-live="polite"></p>
      </section>
    </main>
  `;

  document.querySelector("#logoutBtn").onclick = () => {
    sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    renderAdminLogin();
  };

  document.querySelector("#addInvitationForm").onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const status = document.querySelector("#adminStatus");

    try {
      await adminRequest("/admin/invitations", {
        method: "POST",
        body: JSON.stringify({
          guest_name: formData.get("guest_name"),
          invite_key: formData.get("invite_key"),
          answer: formData.get("answer"),
          party_size: formData.get("party_size"),
          accommodation_enabled: formData.get("accommodation_enabled") === "on",
        }),
      });
      form.reset();
      status.className = "status status-success";
      status.textContent = "Invitația a fost adăugată.";
      await loadAdminPage();
    } catch (error) {
      status.className = "status status-error";
      status.textContent = error.message;
    }
  };

  document.querySelectorAll(".save-row-btn").forEach((button) => {
    button.onclick = async () => {
      const card = button.closest(".invitation-card");
      const id = card.dataset.id;

      await updateInvitationRow(id, card, button);
    };
  });

  document.querySelectorAll(".regenerate-btn").forEach((button) => {
    button.onclick = async () => {
      const card = button.closest(".invitation-card");
      const id = card.dataset.id;
      const keyInput = card.querySelector('[name="invite_key"]');

      button.disabled = true;

      try {
        const data = await adminRequest(`/admin/invitations/${id}/regenerate-key`, {
          method: "POST",
        });
        keyInput.value = data.invitation.invite_key;
      } catch (error) {
        alert(error.message);
      } finally {
        button.disabled = false;
      }
    };
  });

  document.querySelectorAll(".copy-link-btn").forEach((button) => {
    button.onclick = async () => {
      const card = button.closest(".invitation-card");
      const keyInput = card.querySelector('[name="invite_key"]');

      button.disabled = true;

      try {
        await copyText(getInvitationUrl(keyInput.value.trim()));
      } catch (error) {
        alert("Linkul nu a putut fi copiat.");
      } finally {
        button.disabled = false;
      }
    };
  });

  document.querySelectorAll(".delete-row-btn").forEach((button) => {
    button.onclick = async () => {
      const card = button.closest(".invitation-card");
      const id = card.dataset.id;
      const guestName = card.querySelector('[name="guest_name"]').value;

      if (!confirm(`Ștergi invitația pentru ${guestName}?`)) {
        return;
      }

      button.disabled = true;

      try {
        await adminRequest(`/admin/invitations/${id}`, { method: "DELETE" });
        await loadAdminPage();
      } catch (error) {
        alert(error.message);
        button.disabled = false;
      }
    };
  });

  setupInvitationDragAndDrop();

  document.querySelector("#emailEnabledToggle").onchange = async (event) => {
    const toggle = event.currentTarget;
    const status = document.querySelector("#settingsStatus");

    toggle.disabled = true;

    try {
      await adminRequest("/admin/settings", {
        method: "PUT",
        body: JSON.stringify({
          rsvp_email_enabled: toggle.checked,
        }),
      });
      status.className = "status status-success";
      status.textContent = "Setarea a fost salvată.";
    } catch (error) {
      toggle.checked = !toggle.checked;
      status.className = "status status-error";
      status.textContent = error.message;
    } finally {
      toggle.disabled = false;
    }
  };
}

async function updateInvitationRow(id, card, button) {
  button.disabled = true;

  try {
    await adminRequest(`/admin/invitations/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        guest_name: card.querySelector('[name="guest_name"]').value,
        invite_key: card.querySelector('[name="invite_key"]').value,
        answer: card.querySelector('[name="answer"]').value,
        party_size: card.querySelector('[name="party_size"]').value,
        accommodation_enabled: card.querySelector('[name="accommodation_enabled"]').checked,
        accommodation_requested: card.querySelector('[name="accommodation_requested"]').value === "true",
      }),
    });
    await loadAdminPage();
  } catch (error) {
    alert(error.message);
    button.disabled = false;
  }
}

function setupInvitationDragAndDrop() {
  const list = document.querySelector("#invitationList");

  if (!list) {
    return;
  }

  list.querySelectorAll(".invitation-card").forEach((card) => {
    card.addEventListener("dragstart", () => {
      card.classList.add("is-dragging");
    });

    card.addEventListener("dragend", async () => {
      card.classList.remove("is-dragging");
      await saveInvitationOrder(list);
    });
  });

  list.addEventListener("dragover", (event) => {
    event.preventDefault();

    const draggingCard = list.querySelector(".is-dragging");
    const afterCard = getDragAfterCard(list, event.clientY);

    if (!draggingCard) {
      return;
    }

    if (!afterCard) {
      list.appendChild(draggingCard);
    } else {
      list.insertBefore(draggingCard, afterCard);
    }
  });
}

function getDragAfterCard(list, y) {
  const cards = [...list.querySelectorAll(".invitation-card:not(.is-dragging)")];

  return cards.reduce(
    (closest, card) => {
      const box = card.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;

      if (offset < 0 && offset > closest.offset) {
        return { offset, element: card };
      }

      return closest;
    },
    { offset: Number.NEGATIVE_INFINITY, element: null }
  ).element;
}

async function saveInvitationOrder(list) {
  const ids = [...list.querySelectorAll(".invitation-card")].map((card) => card.dataset.id);

  try {
    await adminRequest("/admin/invitations/reorder", {
      method: "PUT",
      body: JSON.stringify({ ids }),
    });
  } catch (error) {
    alert(error.message);
    await loadAdminPage();
  }
}

async function loadAdminPage() {
  const token = sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);

  if (!token) {
    renderAdminLogin();
    return;
  }

  const headers = {
    "x-admin-token": token,
  };
  const [invitationsResponse, settingsResponse] = await Promise.all([
    fetch(`${API_URL}/admin/invitations`, { headers }),
    fetch(`${API_URL}/admin/settings`, { headers }),
  ]);

  if (invitationsResponse.status === 401 || settingsResponse.status === 401) {
    sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    renderAdminLogin("Token invalid.");
    return;
  }

  if (!invitationsResponse.ok || !settingsResponse.ok) {
    renderAdminLogin("Datele nu au putut fi încărcate.");
    return;
  }

  const dashboard = await invitationsResponse.json();
  const { settings } = await settingsResponse.json();

  renderAdminDashboard(dashboard, settings);
}

if (window.location.pathname === "/admin") {
  loadAdminPage();
} else {
  loadInvitation();
}
