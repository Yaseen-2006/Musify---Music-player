// ===== Helpers & constants =====
const $ = (sel) => document.querySelector(sel);
const audio = $('#audio');
const mainEl = $('main');
const viewEl = $('#view');
const PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#3a1220"/>' +
  '<path d="M40 68V36l26-6v32" stroke="#d9b36c" stroke-width="5" fill="none"/>' +
  '<circle cx="34" cy="68" r="7" fill="#d9b36c"/><circle cx="60" cy="62" r="7" fill="#d9b36c"/></svg>');

const ICONS = {
  play: '<path d="M8 5v14l11-7z"/>',
  pause: '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>',
  prev: '<path d="M6 5h2v14H6zM20 5v14L9 12z"/>',
  next: '<path d="M16 5h2v14h-2zM4 5v14l11-7z"/>',
  vol: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 010 6" fill="none" stroke="currentColor" stroke-width="2"/>',
  mute: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2"/>',
  heart: '<path d="M12 21s-8-5.4-8-11a4.5 4.5 0 018-2.8A4.5 4.5 0 0120 10c0 5.6-8 11-8 11z"/>',
  search: '<circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16.5 16.5L21 21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  close: '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  more: '<circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/>',
  download: '<path d="M12 4v10M7.5 10l4.5 4.5 4.5-4.5M5 19h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
};
const icon = (name, size = 22) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true">${ICONS[name]}</svg>`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const stagger = (i) => Math.min(i, 8); // caps the animation delay so long lists don't feel slow

function fmt(t) { // seconds -> 3:42 or 1:05:12 (never NaN)
  if (!isFinite(t) || t < 0) t = 0;
  t = Math.floor(t);
  const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// ===== State =====
const loadList = (key) => { try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; } };
const saveList = (key, value) => localStorage.setItem(key, JSON.stringify(value));

const state = {
  songs: [],            // the central library array
  current: null,        // currently playing song object
  view: 'home',
  query: '',            // text in the Home search box
  searchOpen: false,    // is the search overlay showing?
  artist: null,         // selected artist in Artists view
  dirHandle: null,      // permitted music folder
  pending: null,        // stored folder that needs a click to grant permission again
  booting: true,        // true while we look for the remembered folder / music file
  scanned: false,
  lost: false,          // stored folder no longer reachable
  signature: '',        // names of song folders at the last scan (cheap change detection)
  favorites: loadList('musify.favorites'),
  recent: loadList('musify.recent')
};
let audioUrl = null, scanToken = 0, seeking = false, statusTimer, autoTimer, enterTimer;
let scanning = false, rescanQueued = false, lastResultKey = '', shownId = null, menuTrigger = null;

function notify(message) {
  const box = $('#status');
  box.textContent = message;
  box.classList.add('show');
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => box.classList.remove('show'), 6000);
}

// ===== IndexedDB: remember the folder handle =====
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('musify', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function dbRun(mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', mode);
    const request = action(tx.objectStore('kv'));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
  });
}
const saveHandle = (handle) => dbRun('readwrite', (store) => store.put(handle, 'musicDir'));
const getHandle = () => dbRun('readonly', (store) => store.get('musicDir'));

// ===== Zip support: lets phones (no folder picker) use a downloaded music .zip =====
// The zip is exposed through the same "folder handle" shape as the real picker, so scanning,
// playing and durations work unchanged. Songs are only unpacked when they are played.
const MIME = { mp3: 'audio/mpeg', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', json: 'application/json' };

async function openZipAsFolder(zip) {
  const tailLen = Math.min(zip.size, 65557);
  const tail = new DataView(await zip.slice(zip.size - tailLen).arrayBuffer());
  let end = -1;
  for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('this is not a valid zip file');
  const count = tail.getUint16(end + 10, true), cdSize = tail.getUint32(end + 12, true), cdOff = tail.getUint32(end + 16, true);
  if (count === 0xFFFF || cdOff === 0xFFFFFFFF) throw new Error('zip is too large (Zip64 is not supported)');

  const cd = new DataView(await zip.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const text = new TextDecoder();
  const items = [];
  for (let p = 0, n = 0; n < count && p + 46 <= cd.byteLength; n++) {
    if (cd.getUint32(p, true) !== 0x02014b50) break;
    const method = cd.getUint16(p + 10, true), csize = cd.getUint32(p + 20, true);
    const nlen = cd.getUint16(p + 28, true), elen = cd.getUint16(p + 30, true), clen = cd.getUint16(p + 32, true);
    const off = cd.getUint32(p + 42, true);
    const name = text.decode(new Uint8Array(cd.buffer, p + 46, nlen)).replace(/\\/g, '/');
    p += 46 + nlen + elen + clen;
    if (name.endsWith('/') || name.startsWith('__MACOSX/') || name.includes('/._')) continue;
    items.push({ path: name.split('/').filter(Boolean), method, csize, off });
  }

  // the library root is the folder that holds the song folders (works with or without an outer "Musify" folder)
  const roots = new Map();
  for (const it of items) {
    if (it.path.length >= 2 && it.path[it.path.length - 1].toLowerCase() === 'song.mp3') {
      const root = it.path.slice(0, -2).join('/');
      roots.set(root, (roots.get(root) || 0) + 1);
    }
  }
  const root = [...roots.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  const rootParts = root ? root.split('/') : [];

  const tree = { dirs: new Map(), files: new Map() };
  for (const it of items) {
    if (rootParts.some((part, i) => it.path[i] !== part)) continue;
    const rel = it.path.slice(rootParts.length);
    let node = tree;
    for (const dir of rel.slice(0, -1)) {
      if (!node.dirs.has(dir)) node.dirs.set(dir, { dirs: new Map(), files: new Map() });
      node = node.dirs.get(dir);
    }
    if (rel.length) node.files.set(rel[rel.length - 1], it);
  }

  const fileHandle = (name, it) => ({
    kind: 'file', name,
    async getFile() {
      const head = new DataView(await zip.slice(it.off, it.off + 30).arrayBuffer());
      const start = it.off + 30 + head.getUint16(26, true) + head.getUint16(28, true);
      let blob = zip.slice(start, start + it.csize);
      if (it.method === 8) {
        if (typeof DecompressionStream === 'undefined') throw new Error('this browser cannot unzip compressed files');
        blob = await new Response(blob.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
      } else if (it.method !== 0) throw new Error('unsupported zip compression');
      return new File([blob], name, { type: MIME[name.split('.').pop().toLowerCase()] || '', lastModified: zip.lastModified });
    }
  });
  const folderHandle = (name, node) => ({
    kind: 'directory', name,
    async queryPermission() { return 'granted'; },
    async *entries() {
      for (const [n, child] of node.dirs) yield [n, folderHandle(n, child)];
      for (const [n, it] of node.files) yield [n, fileHandle(n, it)];
    }
  });
  return folderHandle('music', tree);
}

const saveZip = (file) => dbRun('readwrite', (store) => store.put(file, 'musicZip'));
const getZip = () => dbRun('readonly', (store) => store.get('musicZip'));

// ===== Scanning the music folder =====
async function readSong(folder, name) {
  const files = {};
  for await (const [fileName, handle] of folder.entries()) {
    if (handle.kind === 'file') files[fileName.toLowerCase()] = handle;
  }
  if (!files['song.mp3']) throw new Error('song.mp3 missing');
  if (!files['info.json']) throw new Error('info.json missing');

  const info = JSON.parse(await (await files['info.json'].getFile()).text());
  if (!info.title) throw new Error('title missing in info.json');

  let coverUrl = PLACEHOLDER;
  if (files['cover.jpg']) {
    try { coverUrl = URL.createObjectURL(await files['cover.jpg'].getFile()); } catch { /* keep placeholder */ }
  }
  const song = {
    id: name, folderName: name,
    title: String(info.title), artist: info.artist || 'Unknown Artist',
    album: info.album || '', genre: info.genre || '', year: info.year || '',
    audioHandle: files['song.mp3'], // the MP3 is only read when played
    coverUrl, duration: 0, durationKey: ''
  };
  // one lowercase string per song makes searching a single fast includes() check
  song.searchText = [song.title, song.artist, song.album, song.genre].map(String).join('\n').toLowerCase();
  return song;
}

// Called when the folder cannot be read any more: decide between "needs a click" and "gone".
async function handleFolderProblem() {
  const handle = state.dirHandle;
  state.dirHandle = null; state.songs = [];
  let permission = 'denied';
  try { permission = await handle.queryPermission({ mode: 'read' }); } catch { /* treat as lost */ }
  if (permission === 'prompt') state.pending = handle;
  else state.lost = true;
  render();
}

async function scanLibrary(quiet = false) {
  const found = [], skipped = [], names = [];
  try {
    for await (const [name, handle] of state.dirHandle.entries()) {
      if (handle.kind !== 'directory') continue;
      names.push(name);
      try { found.push(await readSong(handle, name)); }
      catch (err) { skipped.push(`${name} (${err.message})`); }
    }
  } catch (err) {
    await handleFolderProblem();
    return false;
  }
  // deterministic order: folder name, numeric aware (song2 before song10)
  found.sort((a, b) => a.folderName.localeCompare(b.folderName, undefined, { numeric: true }));

  // keep durations we already know so a rescan doesn't re-read every MP3
  const known = new Map(state.songs.map((s) => [s.id, s]));
  found.forEach((s) => { const old = known.get(s.id); if (old) { s.duration = old.duration; s.durationKey = old.durationKey; } });

  state.songs.forEach((s) => s.coverUrl.startsWith('blob:') && URL.revokeObjectURL(s.coverUrl));
  state.songs = found;
  state.scanned = true;
  state.signature = names.sort().join('|');

  if (state.current) { // keep the playing song if its folder still exists
    const same = found.find((s) => s.id === state.current.id);
    if (same) state.current = same;
    else { audio.pause(); state.current = null; }
  }
  if (!quiet) notify(skipped.length ? `${found.length} songs loaded. Skipped: ${skipped.join(', ')}` : `${found.length} songs loaded.`);
  if (skipped.length) console.warn('Musify skipped:', skipped);
  updatePlayer();
  render();
  return true;
}

// Only one scan runs at a time; a request that arrives mid-scan is queued once.
async function refreshLibrary(quiet = false) {
  if (scanning) { rescanQueued = true; return; }
  scanning = true;
  try {
    do {
      rescanQueued = false;
      if (await scanLibrary(quiet)) loadDurations();
    } while (rescanQueued);
  } finally { scanning = false; }
}

async function readDuration(file) {
  const url = URL.createObjectURL(file);
  try {
    const probe = new Audio();
    probe.preload = 'metadata';
    probe.src = url;
    await new Promise((ok, fail) => { probe.onloadedmetadata = ok; probe.onerror = fail; });
    return probe.duration;
  } finally { URL.revokeObjectURL(url); }
}

async function loadDurations() { // read each MP3's length one by one in the background
  const token = ++scanToken;
  for (const song of state.songs) {
    if (token !== scanToken) return;
    try {
      const file = await song.audioHandle.getFile();
      const key = `${file.size}:${file.lastModified}`;
      if (!(song.duration && song.durationKey === key)) { // skip files we already measured
        song.duration = await readDuration(file);
        song.durationKey = key;
      }
      document.querySelectorAll(`[data-dur="${CSS.escape(song.id)}"]`).forEach((el) => (el.textContent = fmt(song.duration)));
    } catch { /* leave 0:00 */ }
  }
}

// Auto-refresh is cheap: it lists folder names only and rescans fully only when they changed.
async function autoRefreshTick() {
  if (!state.dirHandle || document.hidden || scanning) return;
  try {
    const names = [];
    for await (const [name, handle] of state.dirHandle.entries()) if (handle.kind === 'directory') names.push(name);
    if (names.sort().join('|') !== state.signature) await refreshLibrary(true);
  } catch { await handleFolderProblem(); }
}

// ===== Playback =====
async function playSong(id) {
  const song = state.songs.find((s) => s.id === id);
  if (!song) return;
  try {
    const file = await song.audioHandle.getFile();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = URL.createObjectURL(file);
    audio.src = audioUrl;
    state.current = song;
    addRecent(id);
    updatePlayer();
    refresh();
    await audio.play();
  } catch (err) {
    if (err.name !== 'AbortError') notify(`Could not play "${song.title}".`);
  }
}

function step(direction) {
  const total = state.songs.length;
  if (!total) return;
  const index = state.songs.indexOf(state.current);
  const next = index < 0 ? 0 : (index + direction + total) % total;
  playSong(state.songs[next].id);
}

function addRecent(id) {
  state.recent = [id, ...state.recent.filter((x) => x !== id)].slice(0, 15);
  saveList('musify.recent', state.recent);
}

function removeRecent(id, refocus = false) {
  state.recent = state.recent.filter((x) => x !== id);
  saveList('musify.recent', state.recent); // saved immediately; the animation is only cosmetic
  const card = document.querySelector(`[data-recent="${CSS.escape(id)}"]`);
  const finish = () => { renderHomeSections(); if (refocus) document.querySelector('[data-menu]')?.focus(); };
  if (card) { card.classList.add('leaving'); setTimeout(finish, 200); } else finish();
}

function toggleFavorite(id) {
  if (!id) return;
  const added = !state.favorites.includes(id);
  state.favorites = added ? [...state.favorites, id] : state.favorites.filter((x) => x !== id);
  saveList('musify.favorites', state.favorites);
  updatePlayer();
  refresh();
  if (added) popHearts(id);
}

function popHearts(id) { // little bounce on every heart for this song
  document.querySelectorAll(`[data-fav="${CSS.escape(id)}"]`).forEach((el) => {
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
  });
}

function similarSongs(base) { // rule based: artist 3 points, genre 2, album 1
  return state.songs
    .filter((s) => s.id !== base.id)
    .map((s) => ({ s, score: (s.artist === base.artist ? 3 : 0) + (s.genre && s.genre === base.genre ? 2 : 0) + (s.album && s.album === base.album ? 1 : 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((x) => x.s);
}

// ===== Rendering: small building blocks =====
const heartButton = (id) => `<button class="icon heart ${state.favorites.includes(id) ? 'on' : ''}" data-fav="${esc(id)}" aria-label="Toggle favorite" aria-pressed="${state.favorites.includes(id)}">${icon('heart')}</button>`;

const art = (url, alt, badge = false) => `<div class="art"><img src="${url}" alt="${esc(alt)}" loading="lazy">${badge ? `<span class="play-badge" aria-hidden="true">${icon('play', 18)}</span>` : ''}</div>`;

const songRow = (s, i = 0) => `
  <div class="row ${state.current && state.current.id === s.id ? 'active' : ''}" style="--i:${stagger(i)}" data-play="${esc(s.id)}" role="button" tabindex="0" aria-label="Play ${esc(s.title)} by ${esc(s.artist)}">
    <img src="${s.coverUrl}" alt="" loading="lazy">
    <div class="meta"><b>${esc(s.title)}</b><span>${esc(s.artist)}</span></div>
    <span class="album">${esc(s.album)}</span>
    <span class="dur" data-dur="${esc(s.id)}">${fmt(s.duration)}</span>
    ${heartButton(s.id)}
  </div>`;

const songCard = (s, i = 0, delayed = true) => `
  <div class="card" ${delayed ? `style="--i:${stagger(i)}"` : ''} data-play="${esc(s.id)}" role="button" tabindex="0" aria-label="Play ${esc(s.title)} by ${esc(s.artist)}">
    ${art(s.coverUrl, 'Cover of ' + s.title, true)}
    <b>${esc(s.title)}</b><span>${esc(s.artist)}</span>
  </div>`;

// Recently Played card: the three-dot button is a sibling of the card, so clicking it never plays the song.
const recentCard = (s, i = 0) => `
  <div class="card-wrap" style="--i:${stagger(i)}" data-recent="${esc(s.id)}">
    ${songCard(s, i, false)}
    <button class="more" data-menu="${esc(s.id)}" aria-label="More options for ${esc(s.title)}" aria-haspopup="menu" aria-expanded="false">${icon('more', 18)}</button>
  </div>`;

const songList = (songs) => `<div class="list">${songs.map((s, i) => songRow(s, i)).join('')}</div>`;

const VINYL = '<svg class="vinyl" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="30" fill="#1e1819" stroke="#4a1626" stroke-width="2"/><circle cx="32" cy="32" r="22" fill="none" stroke="#2a2224"/><circle cx="32" cy="32" r="15" fill="none" stroke="#2a2224"/><circle cx="32" cy="32" r="10" fill="#7a1f35"/><circle cx="32" cy="32" r="2.5" fill="#d9b36c"/></svg>';
// The zip with the sample music. Put it next to index.html (same folder) with exactly this name.
const MUSIC_ZIP = 'musify-music.zip';
const downloadButton = () => `<a class="btn" href="${MUSIC_ZIP}" download="${MUSIC_ZIP}" data-download>${icon('download', 18)}<span>Download Music File</span></a>`;
const selectZipButton = (primary = true) => `<button class="btn${primary ? ' primary' : ''}" data-action="chooseZip">Select Music File</button>`;
const emptyState = (title, text, button = '', extra = '') => `<div class="empty ${extra}">${VINYL}<h2>${title}</h2><p>${text}</p>${button}</div>`;

function libraryEmptyState() {
  if (state.booting) return emptyState('Opening your library', 'Looking for the music folder you used last time…', '', 'spin');
  if (!window.showDirectoryPicker) return emptyState('Welcome to Musify', 'This browser can\'t open folders (common on phones). Download the music file, then tap Select Music File and pick the zip you downloaded.', selectZipButton() + ' ' + downloadButton());
  if (state.lost) return emptyState('Music folder not accessible', 'The folder you chose earlier was moved, deleted or its permission was removed. Choose it again.', '<button class="btn primary" data-action="choose">Choose Music Folder</button> ' + downloadButton());
  if (state.pending) return emptyState('Reconnect your music folder', 'Your browser needs your permission again before Musify can read the folder you used last time. Your files stay on your device.', '<button class="btn primary" data-action="reconnect">Reconnect Music Folder</button> <button class="btn" data-action="choose">Choose a different folder</button>');
  if (state.scanned) return emptyState('No music found', 'Add song folders containing song.mp3, info.json and cover.jpg to your music folder, then refresh the library.', '<button class="btn" data-action="refresh">Refresh Library</button>');
  return emptyState('Welcome to Musify', 'Choose your Musify/music folder. Musify will scan every song folder inside it. Don\'t have the music yet? Download it first.', '<button class="btn primary" data-action="choose">Choose Music Folder</button> ' + downloadButton());
}

// ===== Rendering: Home (static shell + replaceable sections) =====
// The shell (greeting + search box + overlay) is built once, so typing never rebuilds it.
function homeShell() {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return `
    <h1 class="greeting">${greeting}</h1>
    <div class="search-wrap" id="searchWrap">
      <div class="search-field">
        <span class="search-icon">${icon('search', 20)}</span>
        <input id="searchBox" class="search" type="search" placeholder="Search songs, artists, albums" aria-label="Search songs, artists, albums and genres" autocomplete="off" spellcheck="false">
        <button class="search-clear" id="searchClear" type="button" aria-label="Clear search" tabindex="-1">${icon('close', 16)}</button>
      </div>
      <div class="search-panel" id="searchPanel" role="region" aria-label="Search results">
        <div class="search-head"><span id="searchCount" aria-live="polite"></span><span class="kbd-hint">Esc to close</span></div>
        <div id="results"></div>
      </div>
    </div>
    <div class="scrim" id="searchScrim"></div>
    <div id="homeSections"></div>`;
}

function renderHome(rebuild) {
  if (rebuild) viewEl.innerHTML = homeShell();
  renderHomeSections();
  renderResults();
}

function renderHomeSections() {
  const el = $('#homeSections');
  if (!el || !state.songs.length) return;
  const artistCount = new Set(state.songs.map((s) => s.artist)).size;
  const recentlyAdded = [...state.songs].reverse().slice(0, 8); // last folders in scan order
  const played = state.recent.map((id) => state.songs.find((s) => s.id === id)).filter(Boolean).slice(0, 6);
  const base = state.current || state.songs[0];
  const similar = similarSongs(base);
  el.innerHTML = `
    <div class="stats"><div><b>${state.songs.length}</b>Songs</div><div><b>${artistCount}</b>Artists</div><div><b>${state.favorites.length}</b>Favorites</div></div>
    <h2>Recently Added</h2><div class="cards">${recentlyAdded.map((s, i) => songCard(s, i)).join('')}</div>
    ${played.length ? `<h2>Recently Played</h2><div class="cards">${played.map((s, i) => recentCard(s, i)).join('')}</div>` : ''}
    <h2>Similar to ${esc(base.title)}</h2>
    ${similar.length ? songList(similar) : '<p class="muted">No similar songs found yet.</p>'}`;
}

// ===== Search overlay =====
function searchHits() { // every typed word must appear somewhere in title/artist/album/genre
  const words = state.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  return state.songs.filter((s) => words.every((w) => s.searchText.includes(w)));
}

function renderResults() { // only touches the results container, never the search box
  const box = $('#results');
  if (!box) return;
  const count = $('#searchCount');
  const hits = searchHits();
  if (!hits) {
    lastResultKey = '';
    count.textContent = 'Search your library';
    box.classList.remove('fx');
    box.innerHTML = '<p class="search-hint">Type to search by title, artist, album or genre.</p>';
    return;
  }
  const key = hits.map((s) => s.id).join('|');
  box.classList.toggle('fx', key !== lastResultKey); // animate only when the result set really changed
  lastResultKey = key;
  count.textContent = `${hits.length} result${hits.length === 1 ? '' : 's'}`;
  box.innerHTML = hits.length ? songList(hits) : emptyState('No results found', `Nothing matches "${esc(state.query.trim())}". Try another title, artist, album or genre.`, '', 'compact');
}

function updateSearchUi() {
  const wrap = $('#searchWrap');
  if (!wrap) return;
  const has = state.query.length > 0;
  wrap.classList.toggle('has-query', has);
  $('#searchClear').tabIndex = has ? 0 : -1;
}

function setSearchOpen(open) { // CSS does the visuals through the "searching" class
  state.searchOpen = open;
  viewEl.classList.toggle('searching', open);
  const sections = $('#homeSections');
  if (sections) sections.inert = open; // background can't be clicked or tabbed while searching
}

function openSearch() {
  if (state.searchOpen) return;
  setSearchOpen(true);
  const wrap = $('#searchWrap');
  if (wrap) { // if the box is scrolled out of view, bring it back
    const gap = wrap.getBoundingClientRect().top - mainEl.getBoundingClientRect().top - 12;
    if (gap < 0) mainEl.scrollBy({ top: gap, behavior: 'smooth' });
  }
}

function closeSearch() {
  const box = $('#searchBox');
  state.query = '';
  if (box) { box.value = ''; box.blur(); }
  updateSearchUi();
  setSearchOpen(false);
  setTimeout(() => { if (!state.searchOpen) renderResults(); }, 300); // reset the panel after it faded out
}

function moveResultFocus(e) { // arrow keys: search box <-> result rows
  const rows = [...document.querySelectorAll('#results [data-play]')];
  const next = rows.indexOf(document.activeElement) + (e.key === 'ArrowDown' ? 1 : -1);
  if (next < 0) $('#searchBox').focus();
  else if (rows[next]) rows[next].focus();
}

// ===== Rendering: other views =====
function renderFavorites(view) {
  const favs = state.songs.filter((s) => state.favorites.includes(s.id));
  view.innerHTML = `<h1>Favorites</h1>` + (favs.length ? songList(favs) : emptyState('No favorites yet', 'Tap the heart on any song to save it here.'));
}

function renderArtists(view) {
  if (state.artist) {
    view.innerHTML = `<button class="btn" data-action="back">Back to artists</button><h1 style="margin-top:16px">${esc(state.artist)}</h1>` + songList(state.songs.filter((s) => s.artist === state.artist));
    return;
  }
  const names = [...new Set(state.songs.map((s) => s.artist))].sort();
  view.innerHTML = `<h1>Artists</h1><div class="cards">` + names.map((name, i) => {
    const theirs = state.songs.filter((s) => s.artist === name);
    return `<div class="card" style="--i:${stagger(i)}" data-artist="${esc(name)}" role="button" tabindex="0" aria-label="Show songs by ${esc(name)}">
      ${art(theirs[0].coverUrl, '')}<b>${esc(name)}</b><span>${theirs.length} song${theirs.length > 1 ? 's' : ''}</span></div>`;
  }).join('') + `</div>`;
}

// Switching to a different screen: reset search/menu, scroll to top, play the enter animation.
function beginViewTransition(mode) {
  closeMenu();
  state.query = ''; state.searchOpen = false; lastResultKey = '';
  viewEl.classList.remove('searching', 'view-in');
  viewEl.dataset.mode = mode;
  mainEl.scrollTop = 0;
  viewEl.classList.add('entering'); // lets cards/rows fade in once, not on every re-render
  clearTimeout(enterTimer);
  enterTimer = setTimeout(() => viewEl.classList.remove('entering'), 900);
  void viewEl.offsetWidth; // restart the CSS animation
  viewEl.classList.add('view-in');
}

function render() {
  document.querySelectorAll('#nav button').forEach((b) => {
    const on = b.dataset.view === state.view;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  const mode = !state.songs.length ? 'empty' : (state.view === 'artists' && state.artist) ? 'artist' : state.view;
  const changed = viewEl.dataset.mode !== mode;
  if (changed) beginViewTransition(mode);
  if (mode === 'empty') viewEl.innerHTML = libraryEmptyState();
  else if (mode === 'home') renderHome(changed);
  else if (mode === 'library') viewEl.innerHTML = `<h1>Library</h1>` + songList(state.songs);
  else if (mode === 'favorites') renderFavorites(viewEl);
  else renderArtists(viewEl);
}

// re-render after play/favorite; on Home only the sections and results change, so the search box keeps focus
function refresh() {
  viewEl.classList.remove('entering');
  if (state.view === 'home' && state.songs.length) { renderHomeSections(); renderResults(); }
  else render();
}

let playIcon = '';
function updatePlayer() {
  const s = state.current;
  $('#pTitle').textContent = s ? s.title : 'Nothing playing';
  $('#pArtist').textContent = s ? s.artist : 'Choose a song';
  $('#pCover').src = s ? s.coverUrl : PLACEHOLDER;
  $('#pFav').dataset.fav = s ? s.id : '';
  $('#pFav').classList.toggle('on', !!s && state.favorites.includes(s.id));
  $('#pFav').setAttribute('aria-pressed', !!s && state.favorites.includes(s.id));
  const want = audio.paused ? 'play' : 'pause';
  if (playIcon !== want) { playIcon = want; $('#playBtn').innerHTML = icon(want); } // swap only when it changes so the icon can animate
  $('.player').classList.toggle('playing', !audio.paused);
  const id = s ? s.id : null;
  if (id !== shownId) { // new song: fade the cover and title in
    shownId = id;
    const now = $('.now');
    now.classList.remove('swap'); void now.offsetWidth; now.classList.add('swap');
  }
}

// ===== Player controls =====
function setFill(input) { // paints the filled part of a range slider
  input.style.setProperty('--p', ((input.value - input.min) / (input.max - input.min)) * 100 + '%');
}
audio.volume = 0.7;
audio.addEventListener('play', updatePlayer);
audio.addEventListener('pause', updatePlayer);
audio.addEventListener('ended', () => step(1)); // after the last song it loops to the first
audio.addEventListener('loadedmetadata', () => ($('#dur').textContent = fmt(audio.duration)));
audio.addEventListener('timeupdate', () => {
  $('#cur').textContent = fmt(audio.currentTime);
  if (!seeking) { $('#seek').value = audio.duration ? (audio.currentTime / audio.duration) * 1000 : 0; setFill($('#seek')); }
});

$('#playBtn').onclick = () => {
  if (!state.current) return state.songs.length && playSong(state.songs[0].id);
  audio.paused ? audio.play() : audio.pause();
};
$('#prevBtn').onclick = () => (audio.currentTime > 3 ? (audio.currentTime = 0) : step(-1));
$('#nextBtn').onclick = () => step(1);

const seekBar = $('#seek');
seekBar.addEventListener('pointerdown', () => (seeking = true));
seekBar.addEventListener('pointerup', () => (seeking = false));
seekBar.addEventListener('pointercancel', () => (seeking = false));
seekBar.addEventListener('change', () => (seeking = false));
seekBar.addEventListener('input', () => { setFill(seekBar); if (audio.duration) audio.currentTime = (seekBar.value / 1000) * audio.duration; });

function updateMuteIcon() {
  $('#muteBtn').innerHTML = icon(audio.muted ? 'mute' : 'vol');
  $('#muteBtn').classList.toggle('on', audio.muted);
}
$('#vol').addEventListener('input', (e) => { audio.volume = e.target.value; audio.muted = Number(e.target.value) === 0; setFill(e.target); updateMuteIcon(); });
$('#muteBtn').onclick = () => { audio.muted = !audio.muted; updateMuteIcon(); };

// ===== Recently Played context menu (one shared menu element) =====
const menuEl = document.createElement('div');
menuEl.id = 'ctxMenu';
menuEl.className = 'ctx';
menuEl.setAttribute('role', 'menu');
menuEl.setAttribute('aria-label', 'Song options');
document.body.appendChild(menuEl);

function openMenu(trigger, viaKeyboard) {
  const id = trigger.dataset.menu;
  const isFav = state.favorites.includes(id);
  menuEl.dataset.id = id;
  menuEl.dataset.kb = viaKeyboard ? '1' : '';
  menuEl.innerHTML = `
    <button type="button" role="menuitem" data-menu-action="remove-recent">${icon('trash', 18)}<span>Remove from Recently Played</span></button>
    <button type="button" role="menuitem" data-menu-action="toggle-fav">${icon('heart', 18)}<span>${isFav ? 'Remove from Favorites' : 'Add to Favorites'}</span></button>`;
  menuTrigger = trigger;
  trigger.setAttribute('aria-expanded', 'true');

  // place it under the button, flip above / clamp to the screen if there is no room
  const r = trigger.getBoundingClientRect();
  const w = menuEl.offsetWidth, h = menuEl.offsetHeight;
  const below = r.bottom + 6 + h <= window.innerHeight - 8;
  menuEl.style.left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8) + 'px';
  menuEl.style.top = (below ? r.bottom + 6 : Math.max(8, r.top - h - 6)) + 'px';
  menuEl.style.transformOrigin = `${below ? 'top' : 'bottom'} right`;
  menuEl.classList.add('open');
  menuEl.querySelector('button').focus();
}

function closeMenu(returnFocus = false) {
  if (!menuTrigger) return;
  menuEl.classList.remove('open');
  menuTrigger.setAttribute('aria-expanded', 'false');
  if (returnFocus) menuTrigger.focus();
  menuTrigger = null;
}

function runMenuAction(action) {
  const id = menuEl.dataset.id;
  const viaKeyboard = menuEl.dataset.kb === '1';
  const wasFav = state.favorites.includes(id);
  closeMenu();
  if (action === 'remove-recent') {
    removeRecent(id, viaKeyboard);
    notify('Removed from Recently Played.');
  } else if (action === 'toggle-fav') {
    toggleFavorite(id);
    notify(wasFav ? 'Removed from Favorites.' : 'Added to Favorites.');
    if (viaKeyboard) document.querySelector(`[data-menu="${CSS.escape(id)}"]`)?.focus();
  }
}
mainEl.addEventListener('scroll', () => closeMenu(), { passive: true });
window.addEventListener('resize', () => closeMenu());

// ===== Folder actions =====
async function askPersistentStorage() { // optional: asks the browser not to evict Musify's saved data
  try { await navigator.storage.persist(); } catch { /* not supported, fine */ }
}

const actions = {
  chooseZip() { $('#zipInput').click(); }, // opens the phone's file picker; the 'change' listener below does the rest
  async choose() {
    if (!window.showDirectoryPicker) return actions.chooseZip();
    try {
      const handle = await window.showDirectoryPicker({ id: 'musify-music', mode: 'read' });
      state.dirHandle = handle; state.pending = null; state.lost = false;
      await saveHandle(handle).catch(() => notify('Could not remember this folder for next time.'));
      askPersistentStorage();
      await refreshLibrary();
    } catch (err) { if (err.name !== 'AbortError') notify('Could not open folder: ' + err.message); }
  },
  async reconnect() { // runs from a button click, which is what lets the browser show its permission prompt
    if (!state.pending) return;
    try {
      if (await state.pending.requestPermission({ mode: 'read' }) === 'granted') {
        state.dirHandle = state.pending; state.pending = null;
        await refreshLibrary();
      } else notify('Permission was not granted. You can try again or choose the folder again.');
    } catch (err) { notify('Could not reconnect: ' + err.message); }
  },
  refresh() { return state.dirHandle ? refreshLibrary() : notify('Choose a music folder first.'); },
  back() { state.artist = null; render(); }
};

// ===== Events (delegation) =====
document.addEventListener('click', (e) => {
  const t = e.target;

  // 1. context menu items and three-dot buttons
  const menuItem = t.closest('[data-menu-action]');
  if (menuItem) return runMenuAction(menuItem.dataset.menuAction);
  const more = t.closest('[data-menu]');
  if (more) {
    const wasOpen = more === menuTrigger;
    closeMenu();
    if (!wasOpen) openMenu(more, e.detail === 0); // detail 0 = opened with the keyboard
    return;
  }
  closeMenu(); // any other click closes an open menu

  // download link: let the browser download the zip, just show a message
  if (t.closest('[data-download]')) return notify(window.showDirectoryPicker ? 'Downloading the music file… check your Downloads folder.' : 'Downloading… when it finishes, tap Select Music File and pick the zip.');

  // 2. search
  if (t.closest('#searchClear') || t.closest('#searchScrim')) return closeSearch();

  // 3. navigation and songs
  const navButton = t.closest('#nav button');
  if (navButton) {
    if (navButton.dataset.view === 'home' && state.view === 'home') { closeSearch(); return mainEl.scrollTo({ top: 0, behavior: 'smooth' }); }
    state.view = navButton.dataset.view; state.artist = null; return render();
  }
  const fav = t.closest('[data-fav]');
  if (fav) return toggleFavorite(fav.dataset.fav);
  const play = t.closest('[data-play]');
  if (play) return playSong(play.dataset.play);
  const artist = t.closest('[data-artist]');
  if (artist) { state.artist = artist.dataset.artist; return render(); }
  const action = t.closest('[data-action]');
  if (action && actions[action.dataset.action]) {
    action.classList.add('busy');
    Promise.resolve(actions[action.dataset.action]()).finally(() => action.classList.remove('busy'));
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { // menu first, then search
    if (menuTrigger) return closeMenu(true);
    if (state.searchOpen) return closeSearch();
    return;
  }
  if (menuTrigger) {
    if (e.key === 'Tab') return closeMenu(true);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = [...menuEl.querySelectorAll('button')];
      const next = items.indexOf(document.activeElement) + (e.key === 'ArrowDown' ? 1 : -1);
      return items[(next + items.length) % items.length].focus();
    }
  }
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && (e.target.id === 'searchBox' || e.target.closest('#results'))) {
    e.preventDefault();
    return moveResultFocus(e);
  }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-play], [data-artist]')) { e.preventDefault(); e.target.click(); }
});

document.addEventListener('input', (e) => {
  if (e.target.id !== 'searchBox') return;
  state.query = e.target.value;
  updateSearchUi();
  openSearch();
  renderResults();
});
document.addEventListener('focusin', (e) => { if (e.target.id === 'searchBox') openSearch(); });
document.addEventListener('focusout', (e) => { // leaving an empty search box closes the overlay
  if (!state.searchOpen || state.query.trim()) return;
  const wrap = $('#searchWrap');
  if (wrap && !wrap.contains(e.relatedTarget)) closeSearch();
});

// a broken or missing image falls back to the placeholder
document.addEventListener('error', (e) => {
  if (e.target.tagName === 'IMG' && e.target.src !== PLACEHOLDER) e.target.src = PLACEHOLDER;
}, true);
$('#autoRefresh').addEventListener('change', (e) => {
  clearInterval(autoTimer);
  if (e.target.checked) autoTimer = setInterval(autoRefreshTick, 30000);
});

$('#zipInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    state.dirHandle = await openZipAsFolder(file);
    state.pending = null; state.lost = false;
    await saveZip(file).catch(() => notify('Could not remember this file for next time.'));
    await refreshLibrary();
  } catch (err) { notify('Could not open the music file: ' + err.message); }
  e.target.value = ''; // lets the same file be picked again later
});

// ===== Start =====
// queryPermission() never shows a prompt: granted -> reconnect now, prompt -> wait for a click.
async function connectStoredFolder(handle) {
  const permission = await handle.queryPermission({ mode: 'read' });
  if (permission === 'granted') { state.dirHandle = handle; await refreshLibrary(); }
  else if (permission === 'prompt') state.pending = handle; // "Reconnect Music Folder" button asks later
  else state.lost = true;                                    // denied: the user must pick the folder again
}

async function init() {
  $('#prevBtn').innerHTML = icon('prev');
  $('#nextBtn').innerHTML = icon('next');
  $('#pFav').innerHTML = icon('heart');
  setFill($('#seek')); setFill($('#vol'));
  updateMuteIcon();
  updatePlayer();
  render();
  if (!window.showDirectoryPicker) $('[data-action="choose"]').textContent = 'Select Music File';
  try {
    if (window.showDirectoryPicker) {
      const stored = await getHandle();
      if (stored) await connectStoredFolder(stored);
    }
    if (!state.dirHandle && !state.pending && !state.lost) { // no remembered folder: try the remembered music zip
      const zip = await getZip();
      if (zip) { state.dirHandle = await openZipAsFolder(zip); await refreshLibrary(); }
    }
  } catch { state.lost = true; }
  state.booting = false;
  render();
}
init();
