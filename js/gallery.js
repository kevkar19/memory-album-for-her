import { db } from "./firebase-init.js";
import {
  collection,
  addDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { CLOUDINARY_UPLOAD_URL, CLOUDINARY_UPLOAD_PRESET } from "./cloudinary-config.js";

const photosCol = collection(db, "photos");

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

function getUploaderName() {
  const select = document.getElementById("uploader-select");
  return select ? select.value : "Someone";
}

function createPlaceholderTile(id) {
  const tile = document.createElement("div");
  tile.className = "gallery-item placeholder";
  tile.id = id;
  tile.innerHTML = `
    <div class="upload-progress">
      <div class="spinner"></div>
      <span class="progress-text">0%</span>
    </div>
  `;
  return tile;
}

async function handleFiles(files) {
  const grid = document.getElementById("gallery-grid");
  const uploader = getUploaderName();

  for (const file of Array.from(files)) {
    if (!file.type.startsWith("image/")) continue;

    const placeholderId = `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const tile = createPlaceholderTile(placeholderId);
    grid.prepend(tile);

    try {
      const result = await uploadToCloudinary(file, (pct) => {
        const span = tile.querySelector(".progress-text");
        if (span) span.textContent = `${pct}%`;
      });

      await addDoc(photosCol, {
        url: result.secure_url,
        publicId: result.public_id,
        width: result.width || null,
        height: result.height || null,
        uploadedBy: uploader,
        createdAt: serverTimestamp(),
      });

      tile.remove();
    } catch (err) {
      console.error(err);
      tile.innerHTML = `<div class="upload-error">Couldn't upload 😢<br><small>${err.message}</small></div>`;
      setTimeout(() => tile.remove(), 3000);
    }
  }
}

function renderPhoto(docSnap) {
  const data = docSnap.data();
  const item = document.createElement("div");
  item.className = "gallery-item";
  item.innerHTML = `
    <img src="${data.url}" alt="A shared memory" loading="lazy" />
    <div class="gallery-caption">${data.uploadedBy ? `by ${data.uploadedBy}` : ""}</div>
  `;
  const img = item.querySelector("img");
  img.addEventListener("load", () => item.classList.add("loaded"));
  item.addEventListener("click", () => openLightbox(data.url));
  return item;
}

function openLightbox(url) {
  const lightbox = document.getElementById("lightbox");
  const img = document.getElementById("lightbox-img");
  img.src = url;
  lightbox.classList.add("active");
}

function closeLightbox() {
  document.getElementById("lightbox").classList.remove("active");
  document.getElementById("lightbox-img").src = "";
}

export function initGallery() {
  const grid = document.getElementById("gallery-grid");
  const fileInput = document.getElementById("photo-input");
  const emptyState = document.getElementById("gallery-empty");
  const select = document.getElementById("uploader-select");

  fileInput.addEventListener("change", (e) => {
    handleFiles(e.target.files);
    fileInput.value = "";
  });

  document.getElementById("lightbox").addEventListener("click", closeLightbox);

  const savedUploader = localStorage.getItem("fh_uploader_name");
  if (savedUploader) select.value = savedUploader;
  select.addEventListener("change", () => {
    localStorage.setItem("fh_uploader_name", select.value);
  });

  const q = query(photosCol, orderBy("createdAt", "desc"));
  onSnapshot(
    q,
    (snapshot) => {
      grid.querySelectorAll(".gallery-item:not(.placeholder)").forEach((el) => el.remove());

      if (snapshot.empty) {
        emptyState.classList.remove("hidden");
        return;
      }
      emptyState.classList.add("hidden");
      snapshot.forEach((docSnap) => {
        grid.appendChild(renderPhoto(docSnap));
      });
    },
    (err) => console.error("Gallery listener error:", err)
  );
}
