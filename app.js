const DB_NAME = "senada-music-library";
const DB_VERSION = 2;
const audio = document.querySelector("#audio-player");
const trackList = document.querySelector("#track-list");
const emptyState = document.querySelector("#empty-state");
const uploadInput = document.querySelector("#music-input");
const playerBar = document.querySelector("#player-bar");
const playButton = document.querySelector("#play-button");
const toast = document.querySelector("#toast");
const connectionLabel = document.querySelector("#connection-label");
const playlistGrid = document.querySelector("#playlist-grid");
const playlistDetail = document.querySelector("#playlist-detail");
const playlistTrackList = document.querySelector("#playlist-track-list");
const recentTrackList = document.querySelector("#recent-track-list");
const objectUrls = new Map();
let database;
let tracks = [];
let playlists = [];
let recentHistory = [];
let currentTrackId = null;
let selectedPlaylistId = null;
let playbackPlaylistId = null;
let toastTimer;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("tracks")) {
        const store = db.createObjectStore("tracks", { keyPath: "id" });
        store.createIndex("addedAt", "addedAt");
      }
      if (!db.objectStoreNames.contains("playlists")) {
        db.createObjectStore("playlists", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("recentlyPlayed")) {
        db.createObjectStore("recentlyPlayed", { keyPath: "trackId" });
      }
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

function createTrackRow(track, options = {}) {
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
  row.querySelector(".track-main").addEventListener("click", options.onPlay || (() => playTrack(track)));
  const removeButton = row.querySelector(".remove-button");
  if (options.onRemove) {
    removeButton.setAttribute("aria-label", options.removeLabel);
    removeButton.addEventListener("click", options.onRemove);
  } else if (options.hideRemove) {
    removeButton.remove();
  } else {
    removeButton.addEventListener("click", () => removeTrack(track));
  }
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

function renderPlaylists() {
  playlistGrid.replaceChildren();
  document.querySelector("#playlist-count").textContent = `${playlists.length} playlist`;
  if (playlists.length === 0) {
    selectedPlaylistId = null;
    playlistDetail.hidden = true;
    const empty = document.createElement("div");
    empty.className = "playlist-empty";
    empty.textContent = "Playlist buatanmu akan muncul di sini.";
    playlistGrid.append(empty);
    return;
  }

  if (!playlists.some((playlist) => playlist.id === selectedPlaylistId)) {
    selectedPlaylistId = playlists[0].id;
  }
  playlists.forEach((playlist) => {
    const card = document.createElement("button");
    card.className = "playlist-card";
    card.type = "button";
    card.setAttribute("aria-pressed", String(playlist.id === selectedPlaylistId));
    card.innerHTML = `
      <span class="playlist-card-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none"><path d="M9 17V5l10-2v12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><ellipse cx="6.5" cy="18" rx="3" ry="2" stroke="currentColor" stroke-width="1.7" transform="rotate(-18 6.5 18)"/><ellipse cx="16.5" cy="15" rx="3" ry="2" stroke="currentColor" stroke-width="1.7" transform="rotate(-18 16.5 15)"/></svg>
      </span>
      <span class="playlist-card-copy">
        <span class="playlist-card-name">${escapeHtml(playlist.name)}</span>
        <span class="playlist-card-count">${playlist.trackIds.length} lagu</span>
      </span>
      <svg class="playlist-card-arrow" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9 18 6-6-6-6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    card.addEventListener("click", () => {
      selectedPlaylistId = playlist.id;
      renderAll();
    });
    playlistGrid.append(card);
  });
  renderSelectedPlaylist();
}

function renderSelectedPlaylist() {
  const playlist = playlists.find((item) => item.id === selectedPlaylistId);
  playlistDetail.hidden = !playlist;
  if (!playlist) return;

  document.querySelector("#selected-playlist-name").textContent = playlist.name;
  const playlistTracks = playlist.trackIds
    .map((trackId) => tracks.find((track) => track.id === trackId))
    .filter(Boolean);
  document.querySelector("#selected-playlist-count").textContent = `${playlistTracks.length} lagu`;
  playlistTrackList.replaceChildren();

  if (playlistTracks.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state playlist-track-empty";
    empty.innerHTML = "<h3>Playlist ini masih kosong</h3><p>Tambahkan lagu dari koleksi musikmu.</p>";
    playlistTrackList.append(empty);
    return;
  }

  playlistTracks.forEach((track) => {
    const row = createTrackRow(track, {
      onPlay: () => playTrack(track, playlist.id),
      onRemove: () => removeTrackFromPlaylist(playlist, track),
      removeLabel: `Hapus ${track.title} dari playlist`
    });
    row.classList.toggle("is-playing", track.id === currentTrackId);
    playlistTrackList.append(row);
  });
}

function renderRecentlyPlayed() {
  recentTrackList.replaceChildren();
  const recentTracks = recentHistory
    .slice()
    .sort((a, b) => b.playedAt - a.playedAt)
    .map((entry) => tracks.find((track) => track.id === entry.trackId))
    .filter(Boolean)
    .slice(0, 5);

  if (recentTracks.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state recent-empty";
    empty.innerHTML = "<h3>Belum ada lagu diputar</h3><p>Lagu yang kamu dengarkan akan muncul di sini.</p>";
    recentTrackList.append(empty);
    return;
  }

  recentTracks.forEach((track) => {
    const row = createTrackRow(track, { hideRemove: true });
    row.classList.toggle("is-playing", track.id === currentTrackId);
    recentTrackList.append(row);
  });
}

function renderAll() {
  renderTracks();
  renderPlaylists();
  renderRecentlyPlayed();
}

async function loadLibrary() {
  const transaction = database.transaction(["tracks", "playlists", "recentlyPlayed"], "readonly");
  const done = transactionDone(transaction);
  const [storedTracks, storedPlaylists, storedHistory] = await Promise.all([
    requestResult(transaction.objectStore("tracks").getAll()),
    requestResult(transaction.objectStore("playlists").getAll()),
    requestResult(transaction.objectStore("recentlyPlayed").getAll()),
    done
  ]);
  tracks = storedTracks.sort((a, b) => b.addedAt - a.addedAt);
  playlists = storedPlaylists.sort((a, b) => b.createdAt - a.createdAt);
  recentHistory = storedHistory;
  renderAll();
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
  renderAll();
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

async function createPlaylist(event) {
  event.preventDefault();
  const nameInput = document.querySelector("#playlist-name-input");
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.focus();
    return;
  }

  const playlist = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name,
    trackIds: [],
    createdAt: Date.now()
  };
  try {
    const transaction = database.transaction("playlists", "readwrite");
    transaction.objectStore("playlists").add(playlist);
    await transactionDone(transaction);
    playlists = [playlist, ...playlists];
    selectedPlaylistId = playlist.id;
    document.querySelector("#create-playlist-dialog").close();
    document.querySelector("#create-playlist-form").reset();
    renderAll();
    showToast(`Playlist “${name}” berhasil dibuat.`);
  } catch (error) {
    showToast(`Playlist gagal dibuat: ${error.message}`, true);
  }
}

function openAddTracksDialog() {
  if (tracks.length === 0) {
    showToast("Unggah musik terlebih dahulu sebelum menambahkan lagu.");
    return;
  }

  const playlist = playlists.find((item) => item.id === selectedPlaylistId);
  if (!playlist) return;
  const options = document.querySelector("#playlist-song-options");
  options.replaceChildren();
  tracks.forEach((track) => {
    const label = document.createElement("label");
    label.className = "track-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = track.id;
    checkbox.checked = playlist.trackIds.includes(track.id);
    const text = document.createElement("span");
    text.className = "track-option-copy";
    const title = document.createElement("span");
    title.className = "track-option-title";
    title.textContent = track.title;
    const size = document.createElement("span");
    size.className = "track-option-size";
    size.textContent = formatSize(track.size);
    text.append(title, size);
    label.append(checkbox, text);
    options.append(label);
  });
  document.querySelector("#add-tracks-dialog").showModal();
}

async function savePlaylistTracks(event) {
  event.preventDefault();
  const playlist = playlists.find((item) => item.id === selectedPlaylistId);
  if (!playlist) return;
  const selectedIds = Array.from(document.querySelectorAll("#playlist-song-options input:checked"))
    .map((checkbox) => checkbox.value)
    .filter((id) => tracks.some((track) => track.id === id));
  const updatedPlaylist = { ...playlist, trackIds: selectedIds };

  try {
    const transaction = database.transaction("playlists", "readwrite");
    transaction.objectStore("playlists").put(updatedPlaylist);
    await transactionDone(transaction);
    playlists = playlists.map((item) => item.id === updatedPlaylist.id ? updatedPlaylist : item);
    document.querySelector("#add-tracks-dialog").close();
    renderAll();
    showToast(`${selectedIds.length} lagu disimpan di “${playlist.name}”.`);
  } catch (error) {
    showToast(`Isi playlist gagal disimpan: ${error.message}`, true);
  }
}

async function removeTrackFromPlaylist(playlist, track) {
  const updatedPlaylist = {
    ...playlist,
    trackIds: playlist.trackIds.filter((trackId) => trackId !== track.id)
  };
  try {
    const transaction = database.transaction("playlists", "readwrite");
    transaction.objectStore("playlists").put(updatedPlaylist);
    await transactionDone(transaction);
    playlists = playlists.map((item) => item.id === playlist.id ? updatedPlaylist : item);
    if (playbackPlaylistId === playlist.id && currentTrackId === track.id) {
      playbackPlaylistId = null;
    }
    renderAll();
    showToast(`“${track.title}” dihapus dari playlist.`);
  } catch (error) {
    showToast(`Lagu gagal dihapus dari playlist: ${error.message}`, true);
  }
}

async function deletePlaylist() {
  const playlist = playlists.find((item) => item.id === selectedPlaylistId);
  if (!playlist || !window.confirm(`Hapus playlist “${playlist.name}”? Lagu di perpustakaan tidak akan dihapus.`)) return;
  try {
    const transaction = database.transaction("playlists", "readwrite");
    transaction.objectStore("playlists").delete(playlist.id);
    await transactionDone(transaction);
    playlists = playlists.filter((item) => item.id !== playlist.id);
    if (playbackPlaylistId === playlist.id) playbackPlaylistId = null;
    selectedPlaylistId = playlists.length > 0 ? playlists[0].id : null;
    renderAll();
    showToast(`Playlist “${playlist.name}” dihapus.`);
  } catch (error) {
    showToast(`Playlist gagal dihapus: ${error.message}`, true);
  }
}

async function recordRecentlyPlayed(track) {
  if (!tracks.some((item) => item.id === track.id)) return;
  const entry = { trackId: track.id, playedAt: Date.now() };
  try {
    const transaction = database.transaction("recentlyPlayed", "readwrite");
    transaction.objectStore("recentlyPlayed").put(entry);
    await transactionDone(transaction);
    recentHistory = recentHistory.filter((item) => item.trackId !== track.id);
    recentHistory.push(entry);
    renderRecentlyPlayed();
  } catch (error) {
    showToast(`Lagu diputar, tetapi riwayat gagal disimpan: ${error.message}`, true);
  }
}

function playTrack(track, playlistId = null) {
  currentTrackId = track.id;
  playbackPlaylistId = playlistId;
  playerBar.hidden = false;
  document.querySelector("#now-playing-title").textContent = track.title;
  audio.src = getObjectUrl(track);
  audio.play().then(async () => {
    document.body.classList.add("is-playing-audio");
    await recordRecentlyPlayed(track);
    renderAll();
  }).catch((error) => {
    document.body.classList.remove("is-playing-audio");
    showToast(`Lagu tidak dapat diputar: ${error.message}`, true);
  });
  renderAll();
}

function playAdjacentTrack(direction) {
  const playlist = playlists.find((item) => item.id === playbackPlaylistId);
  const queue = playlist
    ? playlist.trackIds.map((trackId) => tracks.find((track) => track.id === trackId)).filter(Boolean)
    : tracks;
  if (queue.length === 0) return;
  const currentIndex = queue.findIndex((track) => track.id === currentTrackId);
  const nextIndex = currentIndex < 0
    ? 0
    : (currentIndex + direction + queue.length) % queue.length;
  playTrack(queue[nextIndex], playlist ? playlist.id : null);
}

function handleTrackEnded() {
  const playlist = playlists.find((item) => item.id === playbackPlaylistId);
  const queueLength = playlist ? playlist.trackIds.length : tracks.length;
  if (queueLength > 1) {
    playAdjacentTrack(1);
  } else {
    document.body.classList.remove("is-playing-audio");
  }
}

async function removeTrack(track) {
  try {
    const updatedPlaylists = playlists
      .filter((playlist) => playlist.trackIds.includes(track.id))
      .map((playlist) => ({
        ...playlist,
        trackIds: playlist.trackIds.filter((trackId) => trackId !== track.id)
      }));
    const transaction = database.transaction(["tracks", "playlists", "recentlyPlayed"], "readwrite");
    transaction.objectStore("tracks").delete(track.id);
    transaction.objectStore("recentlyPlayed").delete(track.id);
    updatedPlaylists.forEach((playlist) => transaction.objectStore("playlists").put(playlist));
    await transactionDone(transaction);
    tracks = tracks.filter((item) => item.id !== track.id);
    playlists = playlists.map((playlist) => updatedPlaylists.find((item) => item.id === playlist.id) || playlist);
    recentHistory = recentHistory.filter((item) => item.trackId !== track.id);
    const objectUrl = objectUrls.get(track.id);
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrls.delete(track.id);
    }
    if (currentTrackId === track.id) {
      audio.pause();
      audio.removeAttribute("src");
      currentTrackId = null;
      playbackPlaylistId = null;
      playerBar.hidden = true;
      document.body.classList.remove("is-playing-audio");
    }
    renderAll();
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
document.querySelector("#create-playlist-button").addEventListener("click", () => {
  document.querySelector("#create-playlist-dialog").showModal();
  document.querySelector("#playlist-name-input").focus();
});
document.querySelector("#cancel-create-playlist").addEventListener("click", () => {
  document.querySelector("#create-playlist-dialog").close();
});
document.querySelector("#create-playlist-form").addEventListener("submit", createPlaylist);
document.querySelector("#add-tracks-button").addEventListener("click", openAddTracksDialog);
document.querySelector("#cancel-add-tracks").addEventListener("click", () => {
  document.querySelector("#add-tracks-dialog").close();
});
document.querySelector("#add-tracks-form").addEventListener("submit", savePlaylistTracks);
document.querySelector("#delete-playlist-button").addEventListener("click", deletePlaylist);
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
audio.addEventListener("ended", handleTrackEnded);
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
    renderAll();
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
    await loadLibrary();
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
