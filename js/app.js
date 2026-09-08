// Each module is imported dynamically and independently so that a failure
// to load one (e.g. the Firebase SDK being blocked by a network/extension)
// can never prevent the others from working — the PIN gate in particular
// must always function even if the gallery can't reach Firebase/Cloudinary.
import { ICON_WARNING } from "./icons.js";

async function boot() {
  try {
    const { initGate } = await import("./gate.js");
    initGate();
  } catch (err) {
    console.error("Gate failed to load:", err);
  }

  try {
    const { initGallery } = await import("./gallery.js");
    initGallery();
  } catch (err) {
    console.error("Gallery failed to load:", err);
    const empty = document.getElementById("gallery-empty");
    if (empty) {
      empty.classList.remove("hidden");
      empty.innerHTML = `
        <div class="empty-icon">${ICON_WARNING}</div>
        <p class="empty-title">Couldn't load the gallery</p>
        <p class="empty-subtitle">Check your connection and reload the page</p>
      `;
    }
  }
}

document.addEventListener("DOMContentLoaded", boot);
