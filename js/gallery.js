import { db } from "./firebase-init.js";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import {
  CLOUDINARY_UPLOAD_URL,
  CLOUDINARY_AUDIO_UPLOAD_URL,
  CLOUDINARY_UPLOAD_PRESET,
} from "./cloudinary-config.js";
import { escapeHtml } from "./utils.js";
import { initZoom } from "./zoom.js";

const photosCol = collection(db, "photos");
const songsCol = collection(db, "songs");
const albumsCol = collection(db, "albums");
const CLIP_LENGTH_SECONDS = 20;

let selectedFiles = [];
let editingId = null; // null = add mode, otherwise the id of the photo being edited
let currentLightboxId = null;
let currentLightboxData = null;
let zoomController = null;

let allPhotos = []; // [{id, data}], full list in current sort order
let displayedList = []; // flat list backing lightbox swipe/index navigation
let currentIndex = -1; // index of the open lightbox photo within displayedList
let showFavoritesOnly = false;
let currentAlbumId = null; // set while browsing inside one album

let songsList = []; // [{id, data}], the shared song library
let composerSelectedSongId = "";
let unwireLightboxLoop = null;

let albumsList = []; // [{id, data}], the shared album library
let composerSelectedAlbumId = "";

function uploadToCloudinary(file, onProgress, uploadUrl = CLOUDINARY_UPLOAD_URL) {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", uploadUrl);
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

function formatSecondsToTime(totalSeconds) {
  if (!totalSeconds && totalSeconds !== 0) return "0:00";
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function getUploaderName() {
  const select = document.getElementById("uploader-select");
  return select ? select.value : "Someone";
}

// Loops just the [start, start + CLIP_LENGTH_SECONDS) window of a native
// <audio> element by seeking back once it reaches the end of that window.
// `getStart` is a function (not a fixed value) so a live-dragged slider can
// change the loop point without re-wiring the listeners.
function wireClipLoop(audioEl, getStart) {
  const onTimeUpdate = () => {
    const start = getStart();
    if (audioEl.currentTime >= start + CLIP_LENGTH_SECONDS) {
      audioEl.currentTime = start;
    }
  };
  const onEnded = () => {
    audioEl.currentTime = getStart();
    audioEl.play().catch(() => {});
  };
  audioEl.addEventListener("timeupdate", onTimeUpdate);
  audioEl.addEventListener("ended", onEnded);
  return () => {
    audioEl.removeEventListener("timeupdate", onTimeUpdate);
    audioEl.removeEventListener("ended", onEnded);
  };
}

/* ---------- Song library ---------- */

function findSong(id) {
  return songsList.find((s) => s.id === id) || null;
}

function populateSongSelect(selectedId) {
  const select = document.getElementById("composer-song-select");
  select.innerHTML =
    '<option value="">No song</option>' +
    songsList.map((s) => `<option value="${s.id}">${escapeHtml(s.data.name)}</option>`).join("");
  select.value = selectedId || "";
}

function getComposerClipStart() {
  return parseInt(document.getElementById("clip-start-slider").value, 10) || 0;
}

function updateClipLabel() {
  const start = getComposerClipStart();
  document.getElementById("clip-time-label").textContent =
    `${formatSecondsToTime(start)} – ${formatSecondsToTime(start + CLIP_LENGTH_SECONDS)}`;
}

function stopComposerPreview() {
  const audio = document.getElementById("composer-preview-audio");
  audio.pause();
  document.getElementById("clip-preview-btn").textContent = "▶";
}

function hideClipPicker() {
  document.getElementById("composer-clip-picker").classList.add("hidden");
  stopComposerPreview();
}

function showClipPickerForSong(song, initialStart) {
  const picker = document.getElementById("composer-clip-picker");
  const slider = document.getElementById("clip-start-slider");
  const duration = song.data.duration || 0;
  const maxStart = Math.max(0, Math.floor(duration - CLIP_LENGTH_SECONDS));
  slider.max = String(maxStart);
  slider.disabled = maxStart === 0;
  slider.value = String(Math.min(initialStart || 0, maxStart));
  updateClipLabel();
  picker.classList.remove("hidden");
}

function selectSong(songId, initialStart = 0) {
  composerSelectedSongId = songId || "";
  document.getElementById("composer-song-select").value = composerSelectedSongId;
  stopComposerPreview();

  if (!composerSelectedSongId) {
    hideClipPicker();
    return;
  }
  const song = findSong(composerSelectedSongId);
  if (!song) {
    hideClipPicker();
    return;
  }
  showClipPickerForSong(song, initialStart);
}

function toggleComposerPreview() {
  const audio = document.getElementById("composer-preview-audio");
  const btn = document.getElementById("clip-preview-btn");
  const song = findSong(composerSelectedSongId);
  if (!song) return;

  if (audio.paused) {
    if (audio.src !== song.data.url) audio.src = song.data.url;
    audio.currentTime = getComposerClipStart();
    audio.play().catch(() => {});
    btn.textContent = "⏸";
  } else {
    audio.pause();
    btn.textContent = "▶";
  }
}

async function handleSongFileSelected(file) {
  if (!file || !file.type.startsWith("audio/")) return;

  const statusEl = document.getElementById("composer-song-upload-status");
  const uploadBtn = document.getElementById("composer-song-upload-btn");
  statusEl.textContent = "Uploading song... 0%";
  statusEl.classList.remove("hidden");
  uploadBtn.disabled = true;

  try {
    const result = await uploadToCloudinary(
      file,
      (pct) => {
        statusEl.textContent = `Uploading song... ${pct}%`;
      },
      CLOUDINARY_AUDIO_UPLOAD_URL
    );

    const name = result.original_filename || file.name.replace(/\.[^./\\]+$/, "");
    const songData = {
      name,
      url: result.secure_url,
      publicId: result.public_id,
      duration: Math.round(result.duration || 0),
      uploadedBy: getUploaderName(),
      createdAt: serverTimestamp(),
    };
    const songDocRef = await addDoc(songsCol, songData);

    // Add it locally right away rather than waiting on the snapshot
    // listener, so it's selectable immediately.
    songsList = [{ id: songDocRef.id, data: songData }, ...songsList];
    populateSongSelect(songDocRef.id);
    selectSong(songDocRef.id, 0);
    statusEl.classList.add("hidden");
  } catch (err) {
    console.error("Couldn't upload song:", err);
    statusEl.textContent = "Couldn't upload that song — try again?";
  } finally {
    uploadBtn.disabled = false;
  }
}

/* ---------- Album library ---------- */

function findAlbum(id) {
  return albumsList.find((a) => a.id === id) || null;
}

function populateAlbumSelect(selectedId) {
  const select = document.getElementById("composer-album-select");
  select.innerHTML =
    '<option value="">No album</option>' +
    albumsList.map((a) => `<option value="${a.id}">${escapeHtml(a.data.name)}</option>`).join("");
  select.value = selectedId || "";
}

function selectAlbum(albumId) {
  composerSelectedAlbumId = albumId || "";
  document.getElementById("composer-album-select").value = composerSelectedAlbumId;
}

async function handleAlbumCreate() {
  const input = document.getElementById("composer-album-name-input");
  const name = input.value.trim();
  if (!name) return;

  const btn = document.getElementById("composer-album-create-btn");
  btn.disabled = true;
  try {
    const albumData = { name, uploadedBy: getUploaderName(), createdAt: serverTimestamp() };
    const albumRef = await addDoc(albumsCol, albumData);

    albumsList = [{ id: albumRef.id, data: albumData }, ...albumsList];
    populateAlbumSelect(albumRef.id);
    selectAlbum(albumRef.id);
    document.getElementById("composer-album-new-row").classList.add("hidden");
    input.value = "";
  } catch (err) {
    console.error("Couldn't create album:", err);
    document.getElementById("composer-error").textContent = "Couldn't create that album — try again?";
  } finally {
    btn.disabled = false;
  }
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
  document.getElementById("composer-caption-fields").classList.remove("hidden");
  document.getElementById("composer-multi-hint").classList.add("hidden");
  document.getElementById("composer-error").textContent = "";
  document.getElementById("composer-progress").classList.add("hidden");
  document.getElementById("composer-progress-text").textContent = "Uploading... 0%";
  document.getElementById("composer-song-upload-status").classList.add("hidden");
  selectSong("", 0);
  selectAlbum("");
  document.getElementById("composer-album-new-row").classList.add("hidden");
  document.getElementById("composer-album-name-input").value = "";

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
  selectSong(data.songId || "", data.songStart || 0);
  selectAlbum(data.albumId || "");
  document.getElementById("composer-submit").textContent = "Save";
  document.getElementById("composer-overlay").classList.remove("hidden");
}

function closeComposer() {
  document.getElementById("composer-overlay").classList.add("hidden");
  stopComposerPreview();
}

async function handleComposerSubmit(e) {
  e.preventDefault();
  const errorEl = document.getElementById("composer-error");
  const submitBtn = document.getElementById("composer-submit");
  const captionInput = document.getElementById("composer-caption");
  const subcaptionInput = document.getElementById("composer-subcaption");
  errorEl.textContent = "";

  const isMulti = !editingId && selectedFiles.length > 1;
  const caption = isMulti ? "" : captionInput.value.trim();
  const subcaption = isMulti ? "" : subcaptionInput.value.trim();
  const songId = isMulti ? "" : composerSelectedSongId;
  const songStart = songId ? getComposerClipStart() : null;
  const albumId = composerSelectedAlbumId; // applies to the whole batch, not per-photo

  if (editingId) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Saving...";
    try {
      await updateDoc(doc(db, "photos", editingId), {
        caption: caption || null,
        subcaption: subcaption || null,
        songId: songId || null,
        songStart,
        albumId: albumId || null,
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
        songId: songId || null,
        songStart,
        albumId: albumId || null,
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
      ${data.songId ? '<span class="song-badge">🎵</span>' : ""}
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

// Groups allPhotos into grid entries for the normal (non-album, non-
// favorites) view: consecutive-or-not photos sharing an albumId collapse
// into one album card at the position of their most recent photo, since
// allPhotos is already sorted newest-first. Ungrouped photos pass through
// as individual entries. Returns the flat list of ungrouped photos too,
// since that's what backs lightbox swipe navigation in this view.
function buildGroupedEntries() {
  const entries = [];
  const flatUngrouped = [];
  const seenAlbums = new Map();

  for (const item of allPhotos) {
    const albumId = item.data.albumId;
    if (!albumId) {
      flatUngrouped.push(item);
      entries.push({ type: "photo", item, index: flatUngrouped.length - 1 });
      continue;
    }
    if (!seenAlbums.has(albumId)) {
      const albumEntry = { type: "album", albumId, photos: [] };
      seenAlbums.set(albumId, albumEntry);
      entries.push(albumEntry);
    }
    seenAlbums.get(albumId).photos.push(item);
  }

  return { entries, flatUngrouped };
}

function renderAlbumCard(entry) {
  const album = findAlbum(entry.albumId);
  const name = album ? album.data.name : "Album";
  const photos = entry.photos; // newest first
  const front = photos[0];
  const back = photos[1];

  const el = document.createElement("div");
  el.className = "gallery-item album-card";
  el.innerHTML = `
    <div class="album-stack">
      ${back ? `<img class="album-stack-photo album-stack-back" src="${back.data.url}" alt="" />` : ""}
      <img class="album-stack-photo album-stack-front" src="${front.data.url}" alt="" loading="lazy" />
      <span class="album-count-badge">📷 ${photos.length}</span>
    </div>
    <div class="gallery-caption">
      <p class="gallery-title">${escapeHtml(name)}</p>
    </div>
  `;

  const frontImg = el.querySelector(".album-stack-front");
  frontImg.addEventListener("load", () => el.classList.add("loaded"));
  el.addEventListener("click", () => openAlbum(entry.albumId));
  return el;
}

function renderGrid() {
  const grid = document.getElementById("gallery-grid");
  const emptyState = document.getElementById("gallery-empty");
  const toolbar = document.getElementById("toolbar");
  const albumHeader = document.getElementById("album-header");
  grid.innerHTML = "";

  const inAlbumView = !!currentAlbumId;
  toolbar.classList.toggle("hidden", inAlbumView);
  albumHeader.classList.toggle("hidden", !inAlbumView);

  if (inAlbumView) {
    const album = findAlbum(currentAlbumId);
    document.getElementById("album-header-title").textContent = album ? album.data.name : "Album";
    displayedList = allPhotos.filter((p) => p.data.albumId === currentAlbumId);

    if (displayedList.length === 0) {
      emptyState.classList.remove("hidden");
      emptyState.querySelector(".empty-title").textContent = "No photos in this album";
      emptyState.querySelector(".empty-subtitle").textContent = "";
      return;
    }
    emptyState.classList.add("hidden");
    displayedList.forEach((item, index) => grid.appendChild(renderPhoto(item, index)));
    return;
  }

  if (showFavoritesOnly) {
    displayedList = allPhotos.filter((p) => p.data.favorite);

    if (displayedList.length === 0) {
      emptyState.classList.remove("hidden");
      emptyState.querySelector(".empty-title").textContent = "No favorites yet";
      emptyState.querySelector(".empty-subtitle").textContent = "Tap the heart on a photo to save it here";
      return;
    }
    emptyState.classList.add("hidden");
    displayedList.forEach((item, index) => grid.appendChild(renderPhoto(item, index)));
    return;
  }

  const { entries, flatUngrouped } = buildGroupedEntries();
  displayedList = flatUngrouped;

  if (entries.length === 0) {
    emptyState.classList.remove("hidden");
    emptyState.querySelector(".empty-title").textContent = "No photos yet";
    emptyState.querySelector(".empty-subtitle").textContent = "Add the first one to start the story";
    return;
  }
  emptyState.classList.add("hidden");
  entries.forEach((entry) => {
    grid.appendChild(entry.type === "album" ? renderAlbumCard(entry) : renderPhoto(entry.item, entry.index));
  });
}

function openAlbum(albumId) {
  currentAlbumId = albumId;
  renderGrid();
  renderOnThisDay();
}

function closeAlbumView() {
  currentAlbumId = null;
  renderGrid();
  renderOnThisDay();
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

function stopLightboxAudio() {
  const audio = document.getElementById("lightbox-audio");
  audio.pause();
  unwireLightboxLoop?.();
  unwireLightboxLoop = null;
}

function setupLightboxSong(data) {
  const songEl = document.getElementById("lightbox-song");
  const audio = document.getElementById("lightbox-audio");
  const icon = document.getElementById("lightbox-song-icon");
  stopLightboxAudio();
  audio.src = "";
  songEl.classList.add("hidden");

  if (!data.songId) return;
  const song = findSong(data.songId);
  if (!song) return;

  const start = data.songStart || 0;
  audio.src = song.data.url;
  audio.currentTime = start;
  document.getElementById("lightbox-song-name").textContent = song.data.name;
  icon.textContent = "▶";
  songEl.classList.remove("hidden");
  unwireLightboxLoop = wireClipLoop(audio, () => start);

  audio
    .play()
    .then(() => {
      icon.textContent = "⏸";
    })
    .catch(() => {
      // Autoplay blocked — leave the play icon so they can tap to start it.
    });
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

  setupLightboxSong(data);
  updateLightboxFavButton(data.favorite);

  const deleteBtn = document.getElementById("lightbox-delete");
  deleteBtn.disabled = false;
  deleteBtn.textContent = "Delete this photo";

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
  stopLightboxAudio();
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
  const match = currentAlbumId ? null : findOnThisDayPhoto(allPhotos);

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

  wireClipLoop(document.getElementById("composer-preview-audio"), getComposerClipStart);

  document.getElementById("fav-filter-btn").addEventListener("click", () => {
    showFavoritesOnly = !showFavoritesOnly;
    updateFavFilterButton();
    renderGrid();
  });
  document.getElementById("album-back-btn").addEventListener("click", closeAlbumView);

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

  document.getElementById("composer-song-select").addEventListener("change", (e) => {
    selectSong(e.target.value, 0);
  });
  document.getElementById("composer-song-upload-btn").addEventListener("click", () => {
    document.getElementById("composer-song-file-input").click();
  });
  document.getElementById("composer-song-file-input").addEventListener("change", (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    handleSongFileSelected(file);
  });
  document.getElementById("clip-preview-btn").addEventListener("click", toggleComposerPreview);

  document.getElementById("composer-album-select").addEventListener("change", (e) => {
    selectAlbum(e.target.value);
  });
  document.getElementById("composer-album-new-btn").addEventListener("click", () => {
    document.getElementById("composer-album-new-row").classList.remove("hidden");
    document.getElementById("composer-album-name-input").focus();
  });
  document.getElementById("composer-album-cancel-btn").addEventListener("click", () => {
    document.getElementById("composer-album-new-row").classList.add("hidden");
    document.getElementById("composer-album-name-input").value = "";
  });
  document.getElementById("composer-album-create-btn").addEventListener("click", handleAlbumCreate);
  document.getElementById("clip-start-slider").addEventListener("input", () => {
    updateClipLabel();
    const audio = document.getElementById("composer-preview-audio");
    if (!audio.paused) audio.currentTime = getComposerClipStart();
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
  document.getElementById("lightbox-song-toggle").addEventListener("click", () => {
    const audio = document.getElementById("lightbox-audio");
    const icon = document.getElementById("lightbox-song-icon");
    if (audio.paused) {
      audio
        .play()
        .then(() => {
          icon.textContent = "⏸";
        })
        .catch(() => {});
    } else {
      audio.pause();
      icon.textContent = "▶";
    }
  });
  document.getElementById("lightbox-edit").addEventListener("click", () => {
    if (!currentLightboxId) return;
    const id = currentLightboxId;
    const data = currentLightboxData;
    closeLightbox();
    openComposerForEdit(id, data);
  });
  document.getElementById("lightbox-delete").addEventListener("click", async () => {
    if (!currentLightboxId) return;
    const confirmed = window.confirm("Delete this photo? This can't be undone.");
    if (!confirmed) return;

    const id = currentLightboxId;
    const btn = document.getElementById("lightbox-delete");
    btn.disabled = true;
    btn.textContent = "Deleting...";
    try {
      await deleteDoc(doc(db, "photos", id));
      closeLightbox();
    } catch (err) {
      console.error("Couldn't delete photo:", err);
      btn.disabled = false;
      btn.textContent = "Delete this photo";
      window.alert("Couldn't delete — try again?");
    }
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

  const songsQuery = query(songsCol, orderBy("createdAt", "desc"));
  onSnapshot(
    songsQuery,
    (snapshot) => {
      songsList = snapshot.docs.map((docSnap) => ({ id: docSnap.id, data: docSnap.data() }));
      populateSongSelect(composerSelectedSongId);
    },
    (err) => console.error("Songs listener error:", err)
  );

  const albumsQuery = query(albumsCol, orderBy("createdAt", "desc"));
  onSnapshot(
    albumsQuery,
    (snapshot) => {
      albumsList = snapshot.docs.map((docSnap) => ({ id: docSnap.id, data: docSnap.data() }));
      populateAlbumSelect(composerSelectedAlbumId);
      if (currentAlbumId) renderGrid();
    },
    (err) => console.error("Albums listener error:", err)
  );

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
