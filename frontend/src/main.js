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

  return new Date(`${value}Z`).toLocaleString("ro-RO", {
    timeZone: "Europe/Bucharest",
  });
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

          <button id="submitBtn" class="submit-btn" type="submit" disabled>Trimite răspunsul</button>
          <p id="status" class="status" role="status" aria-live="polite"></p>
        </form>
      </section>
    </main>
  `;

  const form = document.querySelector("#rsvpForm");
  const submitBtn = document.querySelector("#submitBtn");

  form.onchange = () => {
    submitBtn.disabled = !new FormData(form).get("answer");
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

function renderAdminDashboard({ summary, invitations }) {
  const rows = invitations
    .map(
      (invitation) => `
        <tr>
          <td>${escapeHtml(invitation.guest_name)}</td>
          <td><code>${escapeHtml(invitation.invite_key)}</code></td>
          <td><span class="answer answer-${escapeHtml(invitation.answer || "pending")}">${formatAnswer(invitation.answer)}</span></td>
          <td>${formatDate(invitation.created_at)}</td>
          <td>${formatDate(invitation.answered_at)}</td>
        </tr>
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
        <div><strong>${summary.total}</strong><span>Total</span></div>
        <div><strong>${summary.yes}</strong><span>Vin</span></div>
        <div><strong>${summary.no}</strong><span>Nu vin</span></div>
        <div><strong>${summary.pending}</strong><span>Fără răspuns</span></div>
      </section>

      <section class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Invitat</th>
              <th>Cheie</th>
              <th>Răspuns</th>
              <th>Creată</th>
              <th>Răspuns la</th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="5">Nu există invitații încă.</td></tr>'}
          </tbody>
        </table>
      </section>
    </main>
  `;

  document.querySelector("#logoutBtn").onclick = () => {
    sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    renderAdminLogin();
  };
}

async function loadAdminPage() {
  const token = sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);

  if (!token) {
    renderAdminLogin();
    return;
  }

  const response = await fetch(`${API_URL}/admin/invitations`, {
    headers: {
      "x-admin-token": token,
    },
  });

  if (response.status === 401) {
    sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    renderAdminLogin("Token invalid.");
    return;
  }

  if (!response.ok) {
    renderAdminLogin("Datele nu au putut fi încărcate.");
    return;
  }

  renderAdminDashboard(await response.json());
}

if (window.location.pathname === "/admin") {
  loadAdminPage();
} else {
  loadInvitation();
}
