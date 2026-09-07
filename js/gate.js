// Simple client-side PIN gate. This only keeps casual visitors out — the
// PIN's hash lives in this file, which anyone can view in DevTools/source.
// See README.md for the security caveats before treating this as real
// access control.
const PIN_HASH =
  "6b5ef6c4d3f89277ac8ad3b5ea1bff2ce7d2b7a58545403b4cbe4069bfbc77ba";
const STORAGE_KEY = "fh_unlocked";

async function sha256(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function showApp() {
  document.getElementById("gate-overlay").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
}

export function initGate() {
  if (localStorage.getItem(STORAGE_KEY) === "true") {
    showApp();
    return;
  }

  const form = document.getElementById("gate-form");
  const input = document.getElementById("gate-input");
  const error = document.getElementById("gate-error");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const hash = await sha256(input.value.trim());

    if (hash === PIN_HASH) {
      localStorage.setItem(STORAGE_KEY, "true");
      showApp();
    } else {
      error.textContent = "That's not it — try again 💗";
      input.value = "";
      input.focus();
      form.classList.add("shake");
      setTimeout(() => form.classList.remove("shake"), 400);
    }
  });
}
