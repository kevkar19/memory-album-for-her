import { initGate } from "./gate.js";
import { initGallery } from "./gallery.js";
import { initQuotes } from "./quotes.js";
import { initSongs } from "./songs.js";

function initNav() {
  const buttons = document.querySelectorAll(".nav-btn");
  const sections = document.querySelectorAll(".view");

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.target;
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      sections.forEach((sec) => {
        sec.classList.toggle("active", sec.id === target);
      });
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initGate();
  initNav();
  initGallery();
  initQuotes();
  initSongs();
});
