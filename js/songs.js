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

const songsCol = collection(db, "songs");

function parseMusicUrl(url) {
  try {
    const u = new URL(url);

    if (u.hostname.includes("open.spotify.com")) {
      const parts = u.pathname.split("/").filter(Boolean); // [type, id]
      if (parts.length >= 2) {
        const [type, id] = parts;
        return { platform: "spotify", embedSrc: `https://open.spotify.com/embed/${type}/${id}` };
      }
    }

    if (u.hostname.includes("youtube.com") && u.searchParams.get("v")) {
      return { platform: "youtube", embedSrc: `https://www.youtube.com/embed/${u.searchParams.get("v")}` };
    }

    if (u.hostname === "youtu.be") {
      const id = u.pathname.slice(1);
      return { platform: "youtube", embedSrc: `https://www.youtube.com/embed/${id}` };
    }
  } catch (e) {
    return null;
  }
  return null;
}

function renderSong(docSnap) {
  const data = docSnap.data();
  const card = document.createElement("div");
  card.className = "song-card";

  const parsed = parseMusicUrl(data.url);
  let embedHtml;

  if (parsed?.platform === "spotify") {
    embedHtml = `<iframe src="${parsed.embedSrc}" height="152" frameborder="0" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>`;
  } else if (parsed?.platform === "youtube") {
    embedHtml = `<div class="yt-embed"><iframe src="${parsed.embedSrc}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>`;
  } else {
    embedHtml = `<a href="${data.url}" target="_blank" rel="noopener noreferrer">Listen ↗</a>`;
  }

  card.innerHTML = `
    <div class="song-header">
      <strong>${escapeHtml(data.title || "Untitled")}</strong>
      ${data.artist ? `<span class="song-artist">${escapeHtml(data.artist)}</span>` : ""}
    </div>
    <div class="song-embed">${embedHtml}</div>
  `;
  return card;
}

export function initSongs() {
  const list = document.getElementById("songs-list");
  const emptyState = document.getElementById("songs-empty");
  const form = document.getElementById("song-form");
  const titleInput = document.getElementById("song-title-input");
  const artistInput = document.getElementById("song-artist-input");
  const urlInput = document.getElementById("song-url-input");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = titleInput.value.trim();
    const url = urlInput.value.trim();
    if (!title || !url) return;

    const submitBtn = form.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    try {
      await addDoc(songsCol, {
        title,
        artist: artistInput.value.trim() || null,
        url,
        createdAt: serverTimestamp(),
      });
      titleInput.value = "";
      artistInput.value = "";
      urlInput.value = "";
    } catch (err) {
      console.error(err);
      alert("Couldn't save that song — try again?");
    } finally {
      submitBtn.disabled = false;
    }
  });

  const q = query(songsCol, orderBy("createdAt", "desc"));
  onSnapshot(
    q,
    (snapshot) => {
      list.innerHTML = "";
      if (snapshot.empty) {
        emptyState.classList.remove("hidden");
        return;
      }
      emptyState.classList.add("hidden");
      snapshot.forEach((docSnap) => list.appendChild(renderSong(docSnap)));
    },
    (err) => console.error("Songs listener error:", err)
  );
}
