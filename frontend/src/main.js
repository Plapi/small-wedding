const API_URL = "http://localhost:3001/api";

const params = new URLSearchParams(window.location.search);
const inviteKey = params.get("key");

const app = document.querySelector("#app");

async function loadInvitation() {
  if (!inviteKey) {
    app.innerHTML = "Lipsește cheia invitației.";
    return;
  }

  const response = await fetch(`${API_URL}/invitations/${inviteKey}`);
  const invitation = await response.json();

  app.innerHTML = `
    <main style="max-width: 480px; margin: auto; padding: 24px; text-align: center;">
      <h1>Adrian & Liliana</h1>
      <h2>Invitație la Cununie Civilă</h2>
      <p>Bună, ${invitation.guest_name}!</p>
      <p>Vii la cununia noastră?</p>

      <button id="yesBtn">Da, vin</button>
      <button id="noBtn">Nu pot ajunge</button>

      <p id="status"></p>
    </main>
  `;

  document.querySelector("#yesBtn").onclick = () => sendAnswer("yes");
  document.querySelector("#noBtn").onclick = () => sendAnswer("no");
}

async function sendAnswer(answer) {
  await fetch(`${API_URL}/rsvp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      invite_key: inviteKey,
      answer,
    }),
  });

  document.querySelector("#status").textContent = "Răspunsul a fost trimis. Mulțumim!";
}

loadInvitation();