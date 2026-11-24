const DB_NAME = "senada-music-library";
const DB_VERSION = 1;
const audio = document.querySelector("#audio-player");
const trackList = document.querySelector("#track-list");
const emptyState = document.querySelector("#empty-state");
const uploadInput = document.querySelector("#music-input");
const playerBar = document.querySelector("#player-bar");
const playButton = document.querySelector("#play-button");
const toast = document.querySelector("#toast");
const connectionLabel = document.querySelector("#connection-label");
const objectUrls = new Map();
let database;
let tracks = [];
let currentTrackId = null;
let toastTimer;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore("tracks", { keyPath: "id" });
      store.createIndex("addedAt", "addedAt");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Database tidak dapat dibuka."));
    request.onblocked = () => reject(new Error("Database musik sedang dipakai tab lain. Tutup tab Senada lain lalu coba lagi."));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Permintaan penyimpanan gagal."));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("Penyimpanan musik dibatalkan."));
    transaction.onerror = () => reject(transaction.error || new Error("Penyimpanan musik gagal."));
  });
}

function showToast(message, isError = false) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle("is-error", isError);
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 3600);
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function titleFromFilename(filename) {
  return filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || filename;
}

function getObjectUrl(track) {
  if (!objectUrls.has(track.id)) {
    objectUrls.set(track.id, URL.createObjectURL(track.file));
  }
  return objectUrls.get(track.id);
}

function createTrackRow(track) {
  const row = document.createElement("article");
  row.className = "track-row";
  row.dataset.trackId = track.id;
  row.innerHTML = `
    <button class="track-main" type="button" aria-label="Putar ${escapeHtml(track.title)}">
      <span class="track-art" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none"><path d="M9 17V5l10-2v12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><ellipse cx="6.5" cy="18" rx="3" ry="2" stroke="currentColor" stroke-width="1.6" transform="rotate(-18 6.5 18)"/><ellipse cx="16.5" cy="15" rx="3" ry="2" stroke="currentColor" stroke-width="1.6" transform="rotate(-18 16.5 15)"/></svg>
      </span>
      <span class="track-text">
        <span class="track-name">${escapeHtml(track.title)}</span>
        <span class="track-meta">${formatSize(track.size)}</span>
      </span>
    </button>
    <span class="track-duration" aria-label="Durasi">${track.duration ? formatTime(track.duration) : "--:--"}</span>
    <button class="remove-button" type="button" aria-label="Hapus ${escapeHtml(track.title)}">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-.8 12H6.8L6 7m4 4v5m4-5v5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>`;
  row.querySelector(".track-main").addEventListener("click", () => playTrack(track));
  row.querySelector(".remove-button").addEventListener("click", () => removeTrack(track));
  return row;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function renderTracks() {
  const query = document.querySelector("#search-input").value.trim().toLocaleLowerCase();
  const visibleTracks = tracks.filter((track) => track.title.toLocaleLowerCase().includes(query));
  trackList.querySelectorAll(".track-row").forEach((row) => row.remove());
  trackList.querySelector(".search-empty")?.remove();
  emptyState.hidden = tracks.length > 0;
  document.querySelector("#track-count").textContent = `${tracks.length} lagu`;

  if (tracks.length > 0 && visibleTracks.length === 0) {
    const noResults = document.createElement("div");
    noResults.className = "empty-state search-empty";
    noResults.innerHTML = "<h3>Lagu tidak ditemukan</h3><p>Coba kata kunci yang berbeda.</p>";
    trackList.append(noResults);
  } else {
    visibleTracks.forEach((track) => {
      const row = createTrackRow(track);
      row.classList.toggle("is-playing", track.id === currentTrackId);
      trackList.append(row);
    });
  }
}

async function loadTracks() {
  const transaction = database.transaction("tracks", "readonly");
  const done = transactionDone(transaction);
  const [storedTracks] = await Promise.all([
    requestResult(transaction.objectStore("tracks").getAll()),
    done
  ]);
  tracks = storedTracks.sort((a, b) => b.addedAt - a.addedAt);
  renderTracks();
}

async function saveFiles(files) {
  const audioFiles = Array.from(files).filter((file) => file.type.startsWith("audio/") || /\.(mp3|m4a|aac|wav|ogg|flac|opus)$/i.test(file.name));
  if (audioFiles.length === 0) {
    showToast("Tidak ada file audio yang bisa ditambahkan.", true);
    return;
  }

  const transaction = database.transaction("tracks", "readwrite");
  const store = transaction.objectStore("tracks");
  const addedTracks = audioFiles.map((file) => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    title: titleFromFilename(file.name),
    file,
    size: file.size,
    duration: 0,
    addedAt: Date.now()
  }));
  addedTracks.forEach((track) => store.add(track));
  await transactionDone(transaction);
  tracks = [...addedTracks, ...tracks];
  renderTracks();
  showToast(`${addedTracks.length} lagu berhasil disimpan di perangkat.`);

  if (navigator.storage && navigator.storage.persist) {
    try {
      const persisted = await navigator.storage.persist();
      if (!persisted) {
        showToast("Lagu tersimpan, tetapi browser dapat menghapus data jika ruang perangkat hampir penuh.");
      }
    } catch (error) {
      console.error("Persistent storage request failed:", error);
      showToast("Lagu tersimpan, tetapi status penyimpanan permanen tidak dapat dipastikan.");
    }
  }
}

function playTrack(track) {
  currentTrackId = track.id;
  playerBar.hidden = false;
  document.querySelector("#now-playing-title").textContent = track.title;
  audio.src = getObjectUrl(track);
  audio.play().then(() => {
    document.body.classList.add("is-playing-audio");
    renderTracks();
  }).catch((error) => {
    document.body.classList.remove("is-playing-audio");
    showToast(`Lagu tidak dapat diputar: ${error.message}`, true);
  });
  renderTracks();
}

function playAdjacentTrack(direction) {
  if (tracks.length === 0) return;
  const currentIndex = tracks.findIndex((track) => track.id === currentTrackId);
  const nextIndex = currentIndex < 0
    ? 0
    : (currentIndex + direction + tracks.length) % tracks.length;
  playTrack(tracks[nextIndex]);
}

async function removeTrack(track) {
  try {
    const transaction = database.transaction("tracks", "readwrite");
    transaction.objectStore("tracks").delete(track.id);
    await transactionDone(transaction);
    tracks = tracks.filter((item) => item.id !== track.id);
    const objectUrl = objectUrls.get(track.id);
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrls.delete(track.id);
    }
    if (currentTrackId === track.id) {
      audio.pause();
      audio.removeAttribute("src");
      currentTrackId = null;
      playerBar.hidden = true;
      document.body.classList.remove("is-playing-audio");
    }
    renderTracks();
    showToast(`“${track.title}” dihapus dari perangkat.`);
  } catch (error) {
    showToast(`Lagu gagal dihapus: ${error.message}`, true);
  }
}

function updateConnectionStatus() {
  connectionLabel.textContent = navigator.onLine ? "Siap dipakai offline" : "Mode offline aktif";
  document.querySelector("#connection-status").classList.toggle("is-offline", !navigator.onLine);
}

uploadInput.addEventListener("change", async (event) => {
  try {
    await saveFiles(event.target.files);
  } catch (error) {
    showToast(`Musik gagal disimpan: ${error.message}`, true);
  } finally {
    uploadInput.value = "";
  }
});

document.querySelector("#search-input").addEventListener("input", renderTracks);
playButton.addEventListener("click", () => {
  if (audio.paused) {
    audio.play().then(() => document.body.classList.add("is-playing-audio"))
      .catch((error) => showToast(`Lagu tidak dapat diputar: ${error.message}`, true));
  } else {
    audio.pause();
  }
});
document.querySelector("#previous-button").addEventListener("click", () => playAdjacentTrack(-1));
document.querySelector("#next-button").addEventListener("click", () => playAdjacentTrack(1));
document.querySelector("#seek-bar").addEventListener("input", (event) => {
  if (Number.isFinite(audio.duration)) {
    audio.currentTime = (Number(event.target.value) / 1000) * audio.duration;
  }
});
document.querySelector("#volume-bar").addEventListener("input", (event) => {
  audio.volume = Number(event.target.value);
});
audio.volume = 0.8;
audio.addEventListener("play", () => document.body.classList.add("is-playing-audio"));
audio.addEventListener("pause", () => document.body.classList.remove("is-playing-audio"));
audio.addEventListener("ended", () => playAdjacentTrack(1));
audio.addEventListener("timeupdate", () => {
  document.querySelector("#current-time").textContent = formatTime(audio.currentTime);
  document.querySelector("#seek-bar").value = audio.duration
    ? Math.round((audio.currentTime / audio.duration) * 1000)
    : 0;
});
audio.addEventListener("loadedmetadata", () => {
  document.querySelector("#duration-time").textContent = formatTime(audio.duration);
  const currentTrack = tracks.find((track) => track.id === currentTrackId);
  if (currentTrack && Number.isFinite(audio.duration)) {
    currentTrack.duration = audio.duration;
    renderTracks();
    const transaction = database.transaction("tracks", "readwrite");
    transaction.objectStore("tracks").put(currentTrack);
    transactionDone(transaction).catch((error) => showToast(`Durasi lagu gagal disimpan: ${error.message}`, true));
  }
});
audio.addEventListener("error", () => {
  if (audio.error) showToast("Format file ini tidak didukung oleh browser.", true);
});
window.addEventListener("online", updateConnectionStatus);
window.addEventListener("offline", updateConnectionStatus);

async function startApp() {
  updateConnectionStatus();
  try {
    database = await openDatabase();
    await loadTracks();
  } catch (error) {
    showToast(`Penyimpanan tidak dapat dibuka: ${error.message}`, true);
    uploadInput.disabled = true;
  }

  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("./sw.js");
      if (navigator.onLine) connectionLabel.textContent = "Siap dipakai offline";
    } catch (error) {
      showToast(`Mode offline belum aktif. Buka aplikasi melalui HTTPS untuk menyiapkannya.`, true);
      console.error("Service worker registration failed:", error);
    }
  }
}

startApp();
