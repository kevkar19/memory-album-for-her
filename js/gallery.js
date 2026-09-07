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
import { initZoom } from "./zoom.js";

const photosCol = collection(db, "photos");

let selectedFiles = [];
let editingId = null; // null = add mode, otherwise the id of the photo being edited
let currentLightboxId = null;
let currentLightboxData = null;
let zoomController = null;

let allPhotos = []; // [{id, data}], full list in current sort order
let displayedList = []; // filtered subset actually shown (favorites or all)
let currentIndex = -1; // index of the open lightbox photo within displayedList
let showFavoritesOnly = false;

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

function songEmbedHtml(url, { autoplay = false } = {}) {
  const parsed = parseMusicUrl(url);
  if (parsed?.platform === "spotify") {
    const src = autoplay ? `${parsed.embedSrc}?autoplay=1` : parsed.embedSrc;
    return `<iframe src="${src}" height="152" frameborder="0" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>`;
  }
  if (parsed?.platform === "youtube") {
    const src = autoplay ? `${parsed.embedSrc}?autoplay=1` : parsed.embedSrc;
    return `<div class="yt-embed"><iframe src="${src}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>`;
  }
  return `<a href="${url}" target="_blank" rel="noopener noreferrer">Listen ↗</a>`;
}

function getUploaderName() {
  const select = document.getElementById("uploader-select");
  return select ? select.value : "Someone";
}

/* ---------- Composer (add / edit) ---------- */

function resetComposer() {
  selectedFiles = [];
  editingId = null;

  document.getElementById("composer-file-input").value = "";
  const preview = document.getElementById("composer-preview");
  preview.src = "";
  preview.classList.add("hidden");
  const thumbs = document.getElementById("composer-thumbs");
  thumbs.innerHTML = "";
  thumbs.classList.add("hidden");
  document.getElementById("composer-picker-text").classList.remove("hidden");
  document.getElementById("composer-picker-text").textContent = "Tap to choose photos";
  document.getElementById("composer-caption").value = "";
  document.getElementById("composer-subcaption").value = "";
  document.getElementById("composer-song").value = "";
  document.getElementById("composer-caption-fields").classList.remove("hidden");
  document.getElementById("composer-multi-hint").classList.add("hidden");
  document.getElementById("composer-error").textContent = "";
  document.getElementById("composer-progress").classList.add("hidden");
  document.getElementById("composer-progress-text").textContent = "Uploading... 0%";

  const submitBtn = document.getElementById("composer-submit");
  submitBtn.disabled = false;
  submitBtn.textContent = "Share";
}

function renderComposerSelection() {
  const preview = document.getElementById("composer-preview");
  const thumbs = document.getElementById("composer-thumbs");
  const pickerText = document.getElementById("composer-picker-text");
  const captionFields = document.getElementById("composer-caption-fields");
  const multiHint = document.getElementById("composer-multi-hint");
  const submitBtn = document.getElementById("composer-submit");

  pickerText.classList.add("hidden");

  if (selectedFiles.length === 1) {
    preview.src = URL.createObjectURL(selectedFiles[0]);
    preview.classList.remove("hidden");
    thumbs.innerHTML = "";
    thumbs.classList.add("hidden");
    captionFields.classList.remove("hidden");
    multiHint.classList.add("hidden");
    submitBtn.textContent = "Share";
  } else {
    preview.classList.add("hidden");
    preview.src = "";
    thumbs.innerHTML = selectedFiles
      .map((f) => `<img src="${URL.createObjectURL(f)}" alt="" />`)
      .join("");
    thumbs.classList.remove("hidden");
    captionFields.classList.add("hidden");
    multiHint.classList.remove("hidden");
    submitBtn.textContent = `Share ${selectedFiles.length} photos`;
  }
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
  document.getElementById("composer-subcaption").value = data.subcaption || "";
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
  const subcaptionInput = document.getElementById("composer-subcaption");
  const songInput = document.getElementById("composer-song");
  errorEl.textContent = "";

  const isMulti = !editingId && selectedFiles.length > 1;
  const caption = isMulti ? "" : captionInput.value.trim();
  const subcaption = isMulti ? "" : subcaptionInput.value.trim();
  const songUrl = isMulti ? "" : songInput.value.trim();

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
        subcaption: subcaption || null,
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

  if (!selectedFiles.length) {
    errorEl.textContent = "Choose at least one photo.";
    return;
  }

  submitBtn.disabled = true;
  const progress = document.getElementById("composer-progress");
  const progressText = document.getElementById("composer-progress-text");
  progress.classList.remove("hidden");

  const total = selectedFiles.length;
  const uploader = getUploaderName();
  const stillFailed = [];
  let successCount = 0;

  for (let i = 0; i < selectedFiles.length; i++) {
    const file = selectedFiles[i];
    try {
      const result = await uploadToCloudinary(file, (pct) => {
        progressText.textContent =
          total > 1 ? `Uploading photo ${i + 1} of ${total}... ${pct}%` : `Uploading... ${pct}%`;
      });

      await addDoc(photosCol, {
        url: result.secure_url,
        publicId: result.public_id,
        width: result.width || null,
        height: result.height || null,
        uploadedBy: uploader,
        caption: caption || null,
        subcaption: subcaption || null,
        songUrl: songUrl || null,
        createdAt: serverTimestamp(),
      });

      successCount++;
    } catch (err) {
      console.error(err);
      stillFailed.push(file);
    }
  }

  progress.classList.add("hidden");

  if (stillFailed.length === 0) {
    closeComposer();
    return;
  }

  selectedFiles = stillFailed;
  renderComposerSelection();
  submitBtn.disabled = false;
  errorEl.textContent =
    successCount > 0
      ? `${successCount} uploaded, ${stillFailed.length} failed — try again?`
      : "Couldn't upload — try again?";
}

/* ---------- Gallery ---------- */

async function toggleFavorite(id, currentValue) {
  try {
    await updateDoc(doc(db, "photos", id), { favorite: !currentValue });
  } catch (err) {
    console.error("Couldn't toggle favorite:", err);
  }
}

function renderPhoto(item, index) {
  const { id, data } = item;
  const el = document.createElement("div");
  el.className = "gallery-item";

  const textHtml = data.caption
    ? `<p class="gallery-title">${escapeHtml(data.caption)}</p>${
        data.subcaption ? `<p class="gallery-subcaption">${escapeHtml(data.subcaption)}</p>` : ""
      }`
    : `<p class="gallery-meta">by ${escapeHtml(data.uploadedBy || "someone")}</p>`;

  el.innerHTML = `
    <div class="gallery-img-wrap">
      <img src="${data.url}" alt="A shared memory" loading="lazy" />
      <button type="button" class="fav-btn ${data.favorite ? "active" : ""}" aria-label="Favorite">${
    data.favorite ? "♥" : "♡"
  }</button>
      ${data.songUrl ? '<span class="song-badge">🎵</span>' : ""}
    </div>
    <div class="gallery-caption">${textHtml}</div>
  `;

  const img = el.querySelector("img");
  img.addEventListener("load", () => el.classList.add("loaded"));
  el.addEventListener("click", () => openLightboxAt(index));

  el.querySelector(".fav-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFavorite(id, !!data.favorite);
  });

  return el;
}

function applyFilter() {
  displayedList = showFavoritesOnly ? allPhotos.filter((p) => p.data.favorite) : allPhotos;
}

function renderGrid() {
  const grid = document.getElementById("gallery-grid");
  const emptyState = document.getElementById("gallery-empty");
  applyFilter();
  grid.innerHTML = "";

  if (displayedList.length === 0) {
    emptyState.classList.remove("hidden");
    emptyState.querySelector(".empty-title").textContent = showFavoritesOnly
      ? "No favorites yet"
      : "No photos yet";
    emptyState.querySelector(".empty-subtitle").textContent = showFavoritesOnly
      ? "Tap the heart on a photo to save it here"
      : "Add the first one to start the story";
    return;
  }

  emptyState.classList.add("hidden");
  displayedList.forEach((item, index) => grid.appendChild(renderPhoto(item, index)));
}

function updateFavFilterButton() {
  const btn = document.getElementById("fav-filter-btn");
  btn.classList.toggle("active", showFavoritesOnly);
  btn.textContent = showFavoritesOnly ? "♥ Favorites" : "♡ All";
}

function updateLightboxFavButton(isFav) {
  const btn = document.getElementById("lightbox-fav");
  btn.textContent = isFav ? "♥" : "♡";
  btn.classList.toggle("active", !!isFav);
}

function openLightboxAt(index) {
  if (!displayedList.length) return;
  currentIndex = ((index % displayedList.length) + displayedList.length) % displayedList.length;
  const { id, data } = displayedList[currentIndex];
  currentLightboxId = id;
  currentLightboxData = data;

  zoomController?.reset();
  document.getElementById("lightbox-img").src = data.url;

  const captionEl = document.getElementById("lightbox-caption");
  captionEl.textContent = data.caption || "";
  captionEl.classList.toggle("hidden", !data.caption);

  const subcaptionEl = document.getElementById("lightbox-subcaption");
  subcaptionEl.textContent = data.subcaption || "";
  subcaptionEl.classList.toggle("hidden", !data.subcaption);

  const songEl = document.getElementById("lightbox-song");
  songEl.innerHTML = data.songUrl ? songEmbedHtml(data.songUrl, { autoplay: true }) : "";
  songEl.classList.toggle("hidden", !data.songUrl);

  updateLightboxFavButton(data.favorite);

  document.getElementById("lightbox").classList.add("active");
}

function showNextPhoto() {
  if (currentIndex >= 0) openLightboxAt(currentIndex + 1);
}

function showPrevPhoto() {
  if (currentIndex >= 0) openLightboxAt(currentIndex - 1);
}

function closeLightbox() {
  document.getElementById("lightbox").classList.remove("active");
  document.getElementById("lightbox-img").src = "";
  document.getElementById("lightbox-song").innerHTML = "";
  currentLightboxId = null;
  currentLightboxData = null;
  currentIndex = -1;
  zoomController?.reset();
}

function findOnThisDayPhoto(list) {
  const today = new Date();
  const todayMonth = today.getMonth();
  const todayDate = today.getDate();
  const currentYear = today.getFullYear();

  let best = null;
  for (const item of list) {
    const ts = item.data.createdAt;
    if (!ts?.toDate) continue;
    const d = ts.toDate();
    if (d.getMonth() === todayMonth && d.getDate() === todayDate && d.getFullYear() < currentYear) {
      if (!best || d.getFullYear() > best.date.getFullYear()) {
        best = { item, date: d };
      }
    }
  }
  return best;
}

function renderOnThisDay() {
  const container = document.getElementById("on-this-day");
  const match = findOnThisDayPhoto(allPhotos);

  if (!match) {
    container.classList.add("hidden");
    container.innerHTML = "";
    container.onclick = null;
    return;
  }

  const years = new Date().getFullYear() - match.date.getFullYear();
  const yearsLabel = years === 1 ? "1 year ago" : `${years} years ago`;
  const { item } = match;

  container.innerHTML = `
    <img src="${item.data.url}" alt="" />
    <div class="on-this-day-text">
      <p class="on-this-day-label">✨ On this day, ${yearsLabel}</p>
      <p class="on-this-day-title">${escapeHtml(item.data.caption || "a memory")}</p>
    </div>
  `;
  container.classList.remove("hidden");

  container.onclick = () => {
    if (showFavoritesOnly) {
      showFavoritesOnly = false;
      updateFavFilterButton();
      renderGrid();
    }
    const idx = displayedList.findIndex((p) => p.id === item.id);
    if (idx >= 0) openLightboxAt(idx);
  };
}

export function initGallery() {
  zoomController = initZoom(document.getElementById("lightbox-img"), {
    onSwipeLeft: showNextPhoto,
    onSwipeRight: showPrevPhoto,
  });

  document.getElementById("fav-filter-btn").addEventListener("click", () => {
    showFavoritesOnly = !showFavoritesOnly;
    updateFavFilterButton();
    renderGrid();
  });

  document.getElementById("add-photo-btn").addEventListener("click", openComposerForAdd);
  document.getElementById("composer-close").addEventListener("click", closeComposer);
  document.getElementById("composer-overlay").addEventListener("click", (e) => {
    if (e.target.id === "composer-overlay") closeComposer();
  });
  document.getElementById("composer-form").addEventListener("submit", handleComposerSubmit);

  document.getElementById("composer-file-input").addEventListener("change", (e) => {
    const files = Array.from(e.target.files).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    selectedFiles = files;
    renderComposerSelection();
  });

  const savedUploader = localStorage.getItem("fh_uploader_name");
  const select = document.getElementById("uploader-select");
  if (savedUploader) select.value = savedUploader;
  select.addEventListener("change", () => {
    localStorage.setItem("fh_uploader_name", select.value);
  });

  document.getElementById("lightbox-close").addEventListener("click", closeLightbox);
  document.getElementById("lightbox-prev").addEventListener("click", showPrevPhoto);
  document.getElementById("lightbox-next").addEventListener("click", showNextPhoto);
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
  document.getElementById("lightbox-fav").addEventListener("click", async () => {
    if (!currentLightboxId) return;
    const newVal = !currentLightboxData.favorite;
    currentLightboxData.favorite = newVal;
    updateLightboxFavButton(newVal);
    try {
      await updateDoc(doc(db, "photos", currentLightboxId), { favorite: newVal });
    } catch (err) {
      console.error("Couldn't toggle favorite:", err);
      currentLightboxData.favorite = !newVal;
      updateLightboxFavButton(!newVal);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (!document.getElementById("lightbox").classList.contains("active")) return;
    if (e.key === "ArrowLeft") showPrevPhoto();
    else if (e.key === "ArrowRight") showNextPhoto();
    else if (e.key === "Escape") closeLightbox();
  });

  const q = query(photosCol, orderBy("createdAt", "desc"));
  onSnapshot(
    q,
    (snapshot) => {
      allPhotos = snapshot.docs.map((docSnap) => ({ id: docSnap.id, data: docSnap.data() }));
      renderGrid();
      renderOnThisDay();
    },
    (err) => console.error("Gallery listener error:", err)
  );
}
