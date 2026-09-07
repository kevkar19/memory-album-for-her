import { db } from "./firebase-init.js";
import {
  collection,
  addDoc,
  updateDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { CLOUDINARY_UPLOAD_URL, CLOUDINARY_UPLOAD_PRESET } from "./cloudinary-config.js";
import { escapeHtml } from "./utils.js";

const photosCol = collection(db, "photos");

let selectedFile = null;
let editingId = null; // null = add mode, otherwise the id of the photo being edited
let currentLightboxId = null;
let currentLightboxData = null;

function uploadToCloudinary(file, onProgress) {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", CLOUDINARY_UPLOAD_URL);
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    });
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        reject(new Error("Upload failed"));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(formData);
  });
}

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

function songEmbedHtml(url) {
  const parsed = parseMusicUrl(url);
  if (parsed?.platform === "spotify") {
    return `<iframe src="${parsed.embedSrc}" height="152" frameborder="0" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>`;
  }
  if (parsed?.platform === "youtube") {
    return `<div class="yt-embed"><iframe src="${parsed.embedSrc}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>`;
  }
  return `<a href="${url}" target="_blank" rel="noopener noreferrer">Listen ↗</a>`;
}

function getUploaderName() {
  const select = document.getElementById("uploader-select");
  return select ? select.value : "Someone";
}

/* ---------- Composer (add / edit) ---------- */

function resetComposer() {
  selectedFile = null;
  editingId = null;

  document.getElementById("composer-file-input").value = "";
  const preview = document.getElementById("composer-preview");
  preview.src = "";
  preview.classList.add("hidden");
  document.getElementById("composer-picker-text").classList.remove("hidden");
  document.getElementById("composer-picker-text").textContent = "Tap to choose a photo";
  document.getElementById("composer-caption").value = "";
  document.getElementById("composer-song").value = "";
  document.getElementById("composer-error").textContent = "";
  document.getElementById("composer-progress").classList.add("hidden");
  document.getElementById("composer-progress-text").textContent = "Uploading... 0%";

  const submitBtn = document.getElementById("composer-submit");
  submitBtn.disabled = false;
  submitBtn.textContent = "Share";
}

function openComposerForAdd() {
  resetComposer();
  document.getElementById("composer-title").textContent = "Add a photo";
  document.getElementById("composer-box").classList.remove("mode-edit");
  document.getElementById("composer-overlay").classList.remove("hidden");
}

function openComposerForEdit(id, data) {
  resetComposer();
  editingId = id;
  document.getElementById("composer-title").textContent = "Edit photo";
  document.getElementById("composer-box").classList.add("mode-edit");

  const preview = document.getElementById("composer-preview");
  preview.src = data.url;
  preview.classList.remove("hidden");
  document.getElementById("composer-picker-text").classList.add("hidden");

  document.getElementById("composer-caption").value = data.caption || "";
  document.getElementById("composer-song").value = data.songUrl || "";
  document.getElementById("composer-submit").textContent = "Save";
  document.getElementById("composer-overlay").classList.remove("hidden");
}

function closeComposer() {
  document.getElementById("composer-overlay").classList.add("hidden");
}

async function handleComposerSubmit(e) {
  e.preventDefault();
  const errorEl = document.getElementById("composer-error");
  const submitBtn = document.getElementById("composer-submit");
  const captionInput = document.getElementById("composer-caption");
  const songInput = document.getElementById("composer-song");
  errorEl.textContent = "";

  const caption = captionInput.value.trim();
  const songUrl = songInput.value.trim();

  if (songUrl && !parseMusicUrl(songUrl)) {
    errorEl.textContent = "That link doesn't look like Spotify or YouTube.";
    return;
  }

  if (editingId) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Saving...";
    try {
      await updateDoc(doc(db, "photos", editingId), {
        caption: caption || null,
        songUrl: songUrl || null,
      });
      closeComposer();
    } catch (err) {
      console.error(err);
      errorEl.textContent = "Couldn't save — try again?";
      submitBtn.disabled = false;
      submitBtn.textContent = "Save";
    }
    return;
  }

  if (!selectedFile) {
    errorEl.textContent = "Choose a photo first.";
    return;
  }

  submitBtn.disabled = true;
  const progress = document.getElementById("composer-progress");
  const progressText = document.getElementById("composer-progress-text");
  progress.classList.remove("hidden");

  try {
    const result = await uploadToCloudinary(selectedFile, (pct) => {
      progressText.textContent = `Uploading... ${pct}%`;
    });

    await addDoc(photosCol, {
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width || null,
      height: result.height || null,
      uploadedBy: getUploaderName(),
      caption: caption || null,
      songUrl: songUrl || null,
      createdAt: serverTimestamp(),
    });

    closeComposer();
  } catch (err) {
    console.error(err);
    errorEl.textContent = "Couldn't upload — try again?";
    progress.classList.add("hidden");
    submitBtn.disabled = false;
  }
}

/* ---------- Gallery ---------- */

function renderPhoto(docSnap) {
  const data = docSnap.data();
  const item = document.createElement("div");
  item.className = "gallery-item";

  item.innerHTML = `
    <div class="gallery-img-wrap">
      <img src="${data.url}" alt="A shared memory" loading="lazy" />
      ${data.songUrl ? '<span class="song-badge">🎵</span>' : ""}
    </div>
    <div class="gallery-caption">${
      data.caption ? escapeHtml(data.caption) : `by ${escapeHtml(data.uploadedBy || "someone")}`
    }</div>
  `;

  const img = item.querySelector("img");
  img.addEventListener("load", () => item.classList.add("loaded"));
  item.addEventListener("click", () => openLightbox(docSnap.id, data));
  return item;
}

function openLightbox(id, data) {
  currentLightboxId = id;
  currentLightboxData = data;

  document.getElementById("lightbox-img").src = data.url;

  const captionEl = document.getElementById("lightbox-caption");
  captionEl.textContent = data.caption || "";
  captionEl.classList.toggle("hidden", !data.caption);

  const songEl = document.getElementById("lightbox-song");
  songEl.innerHTML = data.songUrl ? songEmbedHtml(data.songUrl) : "";
  songEl.classList.toggle("hidden", !data.songUrl);

  document.getElementById("lightbox").classList.add("active");
}

function closeLightbox() {
  document.getElementById("lightbox").classList.remove("active");
  document.getElementById("lightbox-img").src = "";
  document.getElementById("lightbox-song").innerHTML = "";
  currentLightboxId = null;
  currentLightboxData = null;
}

export function initGallery() {
  const grid = document.getElementById("gallery-grid");
  const emptyState = document.getElementById("gallery-empty");

  document.getElementById("add-photo-btn").addEventListener("click", openComposerForAdd);
  document.getElementById("composer-close").addEventListener("click", closeComposer);
  document.getElementById("composer-overlay").addEventListener("click", (e) => {
    if (e.target.id === "composer-overlay") closeComposer();
  });
  document.getElementById("composer-form").addEventListener("submit", handleComposerSubmit);

  document.getElementById("composer-file-input").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    selectedFile = file;
    const preview = document.getElementById("composer-preview");
    preview.src = URL.createObjectURL(file);
    preview.classList.remove("hidden");
    document.getElementById("composer-picker-text").classList.add("hidden");
  });

  const savedUploader = localStorage.getItem("fh_uploader_name");
  const select = document.getElementById("uploader-select");
  if (savedUploader) select.value = savedUploader;
  select.addEventListener("change", () => {
    localStorage.setItem("fh_uploader_name", select.value);
  });

  document.getElementById("lightbox-close").addEventListener("click", closeLightbox);
  document.getElementById("lightbox").addEventListener("click", (e) => {
    if (e.target.id === "lightbox") closeLightbox();
  });
  document.getElementById("lightbox-edit").addEventListener("click", () => {
    if (!currentLightboxId) return;
    const id = currentLightboxId;
    const data = currentLightboxData;
    closeLightbox();
    openComposerForEdit(id, data);
  });

  const q = query(photosCol, orderBy("createdAt", "desc"));
  onSnapshot(
    q,
    (snapshot) => {
      grid.innerHTML = "";
      if (snapshot.empty) {
        emptyState.classList.remove("hidden");
        return;
      }
      emptyState.classList.add("hidden");
      snapshot.forEach((docSnap) => grid.appendChild(renderPhoto(docSnap)));
    },
    (err) => console.error("Gallery listener error:", err)
  );
}
