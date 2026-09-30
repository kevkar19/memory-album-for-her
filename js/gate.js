// Client-side PIN gate with a globally-synced lock state stored in
// Firestore (settings/lock), so locking/unlocking applies to every device
// in real time, not just the device that changed it. The gate now depends
// on Firebase loading successfully — see README.md for that trade-off and
// the broader security caveats (the PIN can't be verified server-side
// without a real backend).
import { db } from "./firebase-init.js";
import {
  doc,
  onSnapshot,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const PIN_HASH =
  "6b5ef6c4d3f89277ac8ad3b5ea1bff2ce7d2b7a58545403b4cbe4069bfbc77ba";
const lockRef = doc(db, "settings", "lock");

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

function showGate() {
  document.getElementById("app").classList.add("hidden");
  document.getElementById("gate-overlay").classList.remove("hidden");
}

export function initGate() {
  const form = document.getElementById("gate-form");
  const input = document.getElementById("gate-input");
  const status = document.getElementById("gate-error"); // reused for status + error text

  function setInputEnabled(enabled) {
    input.disabled = !enabled;
    form.querySelector("button[type=submit]").disabled = !enabled;
  }

  // Tracks whether *this device* is currently showing the app, so the
  // snapshot handler below can tell "still locked, nothing changed" (leave
  // whatever's in the status/error text alone — might be a live PIN-error
  // message) apart from "just got force-locked" (show the gate fresh and
  // clear any leftover text) apart from "first load" (also fresh).
  let currentlyShowingApp = false;

  setInputEnabled(false);
  status.textContent = "Checking…";

  document.getElementById("lock-btn").addEventListener("click", async () => {
    if (!window.confirm("Lock the album for both of you?")) return;
    try {
      await setDoc(lockRef, { locked: true, updatedAt: serverTimestamp() }, { merge: true });
    } catch (err) {
      console.error("Couldn't lock the album:", err);
      window.alert("Couldn't lock — try again?");
    }
  });

  onSnapshot(
    lockRef,
    (snap) => {
      const locked = !snap.exists() || snap.data().locked !== false;

      if (!locked) {
        currentlyShowingApp = true;
        showApp();
        return;
      }

      if (currentlyShowingApp) {
        // Just got force-locked from another device, possibly mid-scroll.
        currentlyShowingApp = false;
        showGate();
        status.textContent = "";
        input.value = "";
        window.dispatchEvent(new CustomEvent("album:locked"));
      } else {
        // First load, or a redundant "still locked" update — leave any
        // existing status/error text alone, just make sure the form works.
        if (status.textContent === "Checking…") status.textContent = "";
      }
      setInputEnabled(true);
    },
    (err) => {
      console.error("Lock status listener error:", err);
      currentlyShowingApp = false;
      showGate();
      setInputEnabled(true);
      status.textContent = "Couldn't check the album's status — check your connection.";
    }
  );

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    status.textContent = "";

    try {
      if (!window.crypto?.subtle) {
        status.textContent = "This browser can't open the album — try Chrome or Safari.";
        return;
      }

      const hash = await sha256(input.value.trim());

      if (hash === PIN_HASH) {
        setInputEnabled(false);
        status.textContent = "Opening…";
        try {
          await setDoc(lockRef, { locked: false, updatedAt: serverTimestamp() }, { merge: true });
          // The onSnapshot listener above shows the app once it syncs.
        } catch (err) {
          console.error("Couldn't open the album:", err);
          setInputEnabled(true);
          status.textContent = "Couldn't open — try again?";
        }
      } else {
        status.textContent = "That's not it — try again 💗";
        input.value = "";
        input.focus();
        form.classList.add("shake");
        setTimeout(() => form.classList.remove("shake"), 400);
      }
    } catch (err) {
      console.error("Gate error:", err);
      status.textContent = "Something went wrong — try reloading the page.";
    }
  });
}
