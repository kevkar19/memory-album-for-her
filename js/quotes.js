import { db } from "./firebase-init.js";
import {
  collection,
  addDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { escapeHtml } from "./utils.js";

const quotesCol = collection(db, "quotes");

function renderQuote(docSnap) {
  const data = docSnap.data();
  const card = document.createElement("div");
  card.className = "quote-card";
  card.innerHTML = `
    <p class="quote-text">"${escapeHtml(data.text)}"</p>
    ${data.author ? `<p class="quote-author">— ${escapeHtml(data.author)}</p>` : ""}
  `;
  return card;
}

export function initQuotes() {
  const list = document.getElementById("quotes-list");
  const emptyState = document.getElementById("quotes-empty");
  const form = document.getElementById("quote-form");
  const textInput = document.getElementById("quote-text-input");
  const authorInput = document.getElementById("quote-author-input");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = textInput.value.trim();
    if (!text) return;

    const submitBtn = form.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    try {
      await addDoc(quotesCol, {
        text,
        author: authorInput.value.trim() || null,
        createdAt: serverTimestamp(),
      });
      textInput.value = "";
      authorInput.value = "";
    } catch (err) {
      console.error(err);
      alert("Couldn't save that quote — try again?");
    } finally {
      submitBtn.disabled = false;
    }
  });

  const q = query(quotesCol, orderBy("createdAt", "desc"));
  onSnapshot(
    q,
    (snapshot) => {
      list.innerHTML = "";
      if (snapshot.empty) {
        emptyState.classList.remove("hidden");
        return;
      }
      emptyState.classList.add("hidden");
      snapshot.forEach((docSnap) => list.appendChild(renderQuote(docSnap)));
    },
    (err) => console.error("Quotes listener error:", err)
  );
}
