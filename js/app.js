import * as store from './store.js';
import * as src from './sources.js';
import { CoverFlow } from './coverflow.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const emptyHistory = () => ({
  spotify: { tracks: {}, files: [], plays: 0, first: 0, last: 0 },
  lastfm: { tracks: {}, user: '', plays: 0, last: 0, syncedAt: 0 },
  resolved: {}, // trackKey → { album, artist } for Spotify files without album names
});

const state = {
  library: [],
  history: emptyHistory(),
  sort: store.pref('sort') || 'added',
  current: null,
};

// ---------- Formatting ----------

const dateFmt = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtDate = (ms) => dateFmt.format(new Date(ms));
const plural = (n, word) => `${n.toLocaleString('en')} ${word}${n === 1 ? '' : 's'}`;
const songs = (a) => (a.trackCount ? plural(a.trackCount, 'song') : '');
const dur = (ms) => (ms ? `${Math.floor(ms / 60000)}:${String(Math.round(ms / 1000) % 60).padStart(2, '0')}` : '');
function minutes(a) {
  const m = Math.round((a.durationMs || 0) / 60000);
  if (!m) return '';
  if (m < 60) return `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m / 60} hr`;
}
function isoDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function relative(ms) {
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return fmtDate(ms);
}

// ---------- Saving ----------

let saveTimer = 0;
function saveLibrary() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = 0; store.set('library', state.library); }, 250);
}
const saveHistory = () => store.set('history', state.history);

// Closing the app or switching away saves at once instead of waiting.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden' || !saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = 0;
  store.set('library', state.library);
});

function update(album, patch) {
  Object.assign(album, patch);
  saveLibrary();
}

let toastTimer = 0;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2800);
}

// ---------- Listening statistics ----------

const historySources = () => [state.history.spotify.tracks, state.history.lastfm.tracks];
const hasHistory = () => historySources().some((m) => Object.keys(m).length > 0);

// Plays of an album = plays of its songs. Spotify and Last.fm often record the
// same plays, so for each song we take the higher of the two counts, not the sum.
function statsFor(album) {
  let plays = 0;
  let first = Infinity;
  let last = 0;
  let top = null;
  const seen = new Set();
  for (const t of album.tracks || []) {
    const key = src.trackKey(album.artist, t.title);
    if (seen.has(key)) continue;
    seen.add(key);
    let c = 0;
    for (const m of historySources()) {
      const e = m[key];
      if (!e) continue;
      c = Math.max(c, e.c);
      first = Math.min(first, e.f);
      last = Math.max(last, e.l);
    }
    if (!c) continue;
    plays += c;
    if (!top || c > top.c) top = { title: t.title, c, key };
  }
  return plays ? { plays, first, last, top } : null;
}

// ---------- Backdrop colours ----------

function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Darkens a colour until white text on it stays easy to read.
function tone(rgb, maxL) {
  let c = rgb.map((v) => Math.max(0, v));
  for (let k = 0; k < 40 && luminance(c) > maxL; k++) c = c.map((v) => v * 0.9);
  return c.map(Math.round);
}

function extractColors(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const N = 24;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = N;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, N, N);
        const d = ctx.getImageData(0, 0, N, N).data;
        const halves = [[0, 0, 0, 0], [0, 0, 0, 0]];
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], g = d[i + 1], b = d[i + 2];
          const max = Math.max(r, g, b);
          const sat = max ? (max - Math.min(r, g, b)) / max : 0;
          const w = 0.15 + sat * sat * 3; // colourful pixels count more than greys
          const h = halves[Math.floor(i / 4 / N) < N / 2 ? 0 : 1];
          h[0] += r * w; h[1] += g * w; h[2] += b * w; h[3] += w;
        }
        const [top, bottom] = halves.map((h) => h.slice(0, 3).map((v) => v / h[3]));
        resolve([tone(top, 0.15), tone(bottom, 0.08), tone(top.map((v, i) => (v + bottom[i]) / 2), 0.035)]);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

const layers = [...document.querySelectorAll('#backdrop .layer')];
let layerIdx = 0;
function paint(colors, artwork) {
  const prev = layers[layerIdx];
  layerIdx ^= 1;
  const next = layers[layerIdx];
  const [c1, c2, base] = (colors || [[44, 44, 52], [20, 20, 24], [20, 20, 24]]).map((c) => `rgb(${c.join(',')})`);
  const glow = `radial-gradient(120% 75% at 12% 0%, ${c1} 0%, transparent 72%), radial-gradient(110% 80% at 100% 100%, ${c2} 0%, transparent 72%)`;
  // A small copy of the cover is plenty once it's blurred this much.
  const art = artwork ? `url("${artwork.replace(/\/\d+x\d+bb\.jpg$/, '/200x200bb.jpg')}"), ` : '';
  next.style.background = `${art}${glow}, ${base}`;
  next.style.backgroundSize = 'cover';
  next.style.backgroundPosition = 'center';
  next.classList.add('on');
  prev.classList.remove('on');
  document.querySelector('meta[name="theme-color"]').content = base;
}

async function backdropFor(album) {
  if (!album.colors) {
    const colors = await extractColors(album.artwork);
    if (!colors) return;
    update(album, { colors });
  }
  if (state.current === album) paint(album.colors, album.artwork);
}

// ---------- Wall ----------

const flow = new CoverFlow($('#stage'), { onCenter, onFlip, renderBack });

function sorted() {
  const byName = (a, b) => a.artist.localeCompare(b.artist, 'en', { sensitivity: 'base' });
  const orders = {
    added: (a, b) => b.addedAt.localeCompare(a.addedAt),
    artist: (a, b) => byName(a, b) || (a.year ?? 0) - (b.year ?? 0),
    year: (a, b) => (a.year ?? 9999) - (b.year ?? 9999) || byName(a, b),
    rating: (a, b) => (b.rating || 0) - (a.rating || 0) || b.addedAt.localeCompare(a.addedAt),
  };
  return [...state.library].sort(orders[state.sort] || orders.added);
}

function refreshWall(centerId = state.current?.id) {
  const empty = state.library.length === 0;
  $('#empty').hidden = !empty;
  $('#wall').hidden = empty;
  $('#wall-bar').hidden = empty;
  $('#info').hidden = empty;
  if (empty) {
    state.current = null;
    flow.setItems([], null);
    paint(null);
    return;
  }
  $('#hint').hidden = Boolean(store.pref('hintSeen'));
  flow.setItems(sorted(), centerId);
}

let centerTimer = 0;
let firstCenter = true;
function onCenter(i) {
  const album = flow.items[i];
  if (!album) return;
  if (!firstCenter && state.current !== album) hideHint();
  firstCenter = false;
  state.current = album;
  renderInfo(album);
  $('#position').textContent = `${i + 1} of ${flow.count}`;
  document.querySelector('.nav-btn.prev').disabled = i === 0;
  document.querySelector('.nav-btn.next').disabled = i === flow.count - 1;
  clearTimeout(centerTimer);
  centerTimer = setTimeout(() => {
    backdropFor(album);
    ensureBlurb(album);
    store.pref('center', album.id);
  }, 140);
}

function onFlip(flipped) {
  const btn = $('#i-flip');
  btn.textContent = flipped ? 'Show cover' : 'Show songs';
  btn.setAttribute('aria-pressed', String(flipped));
  if (flipped) hideHint();
}

function hideHint() {
  if ($('#hint').hidden) return;
  $('#hint').hidden = true;
  store.pref('hintSeen', '1');
}

function renderBack(el, album) {
  const stats = statsFor(album);
  const multiDisc = new Set((album.tracks || []).map((t) => t.disc)).size > 1;
  let disc = 0;
  const rows = (album.tracks || []).map((t) => {
    let head = '';
    if (multiDisc && t.disc !== disc) {
      disc = t.disc;
      head = `<li class="disc">Disc ${disc}</li>`;
    }
    const isTop = stats?.top?.c > 1 && stats.top.key === src.trackKey(album.artist, t.title);
    return `${head}<li class="${isTop ? 'top' : ''}"><span class="n">${t.n}</span><span class="t">${esc(t.title)}</span><span class="d">${dur(t.ms)}</span></li>`;
  }).join('');
  el.innerHTML = `
    <button class="back-head" type="button" data-action="unflip" aria-label="Turn back to the cover">
      <span class="back-titles"><strong>${esc(album.title)}</strong><span>${esc([songs(album), minutes(album)].filter(Boolean).join(' · '))}</span></span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4"/></svg>
    </button>
    <ol class="tracks" aria-label="Songs">${rows || '<li><span></span><span class="t">No song list available</span></li>'}</ol>
    <div class="back-actions">
      <a href="${esc(album.appleMusicUrl)}" target="_blank" rel="noopener">Apple Music</a>
      <a href="${esc(src.spotifyUrl(album))}" target="_blank" rel="noopener">Spotify</a>
    </div>`;
}

// ---------- Info panel ----------

const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.9 6 6.5.8-4.8 4.5 1.2 6.5L12 17.3l-5.8 3.1 1.2-6.5-4.8-4.5 6.5-.8z"/></svg>';
const starsEl = $('#i-stars');
starsEl.innerHTML = [1, 2, 3, 4, 5]
  .map((n) => `<button type="button" role="radio" data-star="${n}" aria-label="${plural(n, 'star')}">${STAR}</button>`).join('');

function renderStars(rating = 0) {
  starsEl.querySelectorAll('button').forEach((b) => {
    const n = Number(b.dataset.star);
    b.classList.toggle('on', n <= rating);
    b.setAttribute('aria-checked', String(n === rating));
  });
}

function renderInfo(album) {
  $('#i-title').textContent = album.title;
  $('#i-artist').textContent = album.artist;
  $('#i-meta').textContent = [album.year, album.genre, songs(album), minutes(album)].filter(Boolean).join(' · ');
  renderStars(album.rating);
  $('#i-date').value = album.listenedOn || '';
  $('#i-note').value = album.note || '';
  renderStats(album);
  renderBlurb(album);
}

function renderStats(album) {
  const el = $('#i-stats');
  const s = statsFor(album);
  if (s) {
    el.innerHTML = `
      <p>You’ve played its songs <strong>${plural(s.plays, 'time')}</strong>.</p>
      ${s.top.c > 1 ? `<p>Most played: <strong>${esc(s.top.title)}</strong> (${plural(s.top.c, 'time')})</p>` : ''}
      <p class="muted">First played ${fmtDate(s.first)} · last played ${relative(s.last)}</p>`;
  } else if (hasHistory()) {
    el.innerHTML = '<p class="muted">Not in your listening history yet.</p>';
  } else {
    el.innerHTML = '<p class="muted">Add your Spotify or Last.fm history to see how often you play it. <button class="text-btn" type="button" data-action="settings">Add history</button></p>';
  }
}

const blurbLoading = new Set();
const blurbFailed = new Set();
function renderBlurb(album) {
  const el = $('#i-blurb');
  if (album.blurb) {
    el.innerHTML = `<p>${esc(album.blurb.text)}</p><a class="credit" href="${esc(album.blurb.url)}" target="_blank" rel="noopener">Read more on Wikipedia ›</a>`;
  } else if (album.blurbTried) {
    el.innerHTML = '<p class="muted">Wikipedia doesn’t have a page for this album yet.</p>';
  } else if (blurbFailed.has(album.id)) {
    el.innerHTML = '<p class="muted">Couldn’t load the description. Check your internet connection.</p>';
  } else {
    el.innerHTML = '<p class="muted">Looking it up…</p>';
  }
}

async function ensureBlurb(album) {
  if (album.blurb || album.blurbTried || blurbLoading.has(album.id)) return;
  blurbLoading.add(album.id);
  blurbFailed.delete(album.id);
  try {
    const blurb = await src.fetchBlurb(album.title, album.artist);
    update(album, { blurb, blurbTried: true });
  } catch {
    blurbFailed.add(album.id);
  } finally {
    blurbLoading.delete(album.id);
  }
  if (state.current === album) renderBlurb(album);
}

starsEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-star]');
  const album = state.current;
  if (!b || !album) return;
  const n = Number(b.dataset.star);
  update(album, { rating: album.rating === n ? 0 : n });
  renderStars(album.rating);
});
$('#i-date').addEventListener('change', (e) => state.current && update(state.current, { listenedOn: e.target.value }));
$('#i-note').addEventListener('input', (e) => state.current && update(state.current, { note: e.target.value }));
$('#i-flip').addEventListener('click', () => {
  flow.toggleFlip();
  $('#wall').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
});
$('#i-remove').addEventListener('click', () => {
  const album = state.current;
  if (!album) return;
  if (!confirm(`Remove “${album.title}” from your wall? Your rating and notes for it will be deleted.`)) return;
  const at = flow.center;
  state.library = state.library.filter((a) => a !== album);
  saveLibrary();
  const next = sorted();
  state.current = null;
  refreshWall(next[Math.min(at, next.length - 1)]?.id);
  toast('Removed from your wall');
});

// ---------- Adding albums ----------

const inLibrary = (itunesId) => state.library.some((a) => a.itunesId === itunesId);

async function addAlbum(itunesId, { quiet = false } = {}) {
  const existing = state.library.find((a) => a.itunesId === itunesId);
  if (existing) {
    if (!quiet) { refreshWall(existing.id); toast('Already on your wall'); }
    return true;
  }
  try {
    const data = await src.lookupAlbum(itunesId);
    const album = { ...data, addedAt: new Date().toISOString(), rating: 0, note: '', listenedOn: '', blurb: null, blurbTried: false, colors: null };
    const stats = statsFor(album);
    album.listenedOn = isoDate(stats ? stats.last : Date.now());
    state.library.push(album);
    saveLibrary();
    if (!quiet) {
      refreshWall(album.id);
      toast(`Added “${album.title}”`);
    }
    return true;
  } catch {
    if (!quiet) toast('Couldn’t add the album. Check your internet connection.');
    return false;
  }
}

const CLASSICS = [
  ['Radiohead', 'OK Computer'], ['Fleetwood Mac', 'Rumours'], ['Miles Davis', 'Kind of Blue'],
  ['Amy Winehouse', 'Back to Black'], ['Pink Floyd', 'The Dark Side of the Moon'], ['Daft Punk', 'Random Access Memories'],
  ['Nirvana', 'Nevermind'], ['Lauryn Hill', 'The Miseducation of Lauryn Hill'], ['Kendrick Lamar', 'To Pimp a Butterfly'],
];

async function addClassics(btn) {
  btn.disabled = true;
  let added = 0;
  for (const [artist, title] of CLASSICS) {
    btn.textContent = `Adding ${added + 1} of ${CLASSICS.length}…`;
    try {
      const hit = await src.findAlbum(artist, title);
      if (hit && await addAlbum(hit.itunesId, { quiet: true })) added += 1;
    } catch { /* skip this one */ }
  }
  btn.disabled = false;
  btn.textContent = 'Try it with a few classics';
  if (!added) { toast('Couldn’t reach the catalogue. Check your internet connection.'); return; }
  const list = sorted();
  refreshWall(list[Math.floor(list.length / 2)].id);
  toast(`Added ${plural(added, 'album')}. Swipe to browse!`);
}

// Add sheet
const addSheet = $('#add-sheet');
const searchInput = $('#search-input');
const searchResults = $('#search-results');
const recentResults = $('#recent-results');

const message = (title, text, button = '') =>
  `<li class="message">${title ? `<strong>${esc(title)}</strong>` : ''}${esc(text)}${button}</li>`;
const NOTE_ICON = '<span class="ph"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg></span>';

function openAdd(tab = 'search') {
  selectTab(tab);
  if (!addSheet.open) addSheet.showModal();
  if (tab === 'search') {
    if (!searchInput.value) searchResults.innerHTML = message('Find an album', 'Type the name of an album or an artist.');
    setTimeout(() => searchInput.focus(), 60);
  }
}

function selectTab(tab) {
  const recent = tab === 'recent';
  document.querySelector('.segmented').dataset.tab = tab;
  $('#tab-search').setAttribute('aria-selected', String(!recent));
  $('#tab-recent').setAttribute('aria-selected', String(recent));
  $('#pane-search').hidden = recent;
  $('#pane-recent').hidden = !recent;
  if (recent) renderRecent();
}
$('#tab-search').addEventListener('click', () => openAdd('search'));
$('#tab-recent').addEventListener('click', () => selectTab('recent'));

let searchTimer = 0;
let searchSeq = 0;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 350);
});
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { clearTimeout(searchTimer); runSearch(); }
});

async function runSearch() {
  const term = searchInput.value.trim();
  const seq = ++searchSeq;
  if (!term) { searchResults.innerHTML = message('Find an album', 'Type the name of an album or an artist.'); return; }
  searchResults.innerHTML = message('', 'Searching…');
  try {
    const list = await src.smartSearch(term);
    if (seq !== searchSeq) return;
    searchResults.innerHTML = list.length
      ? list.map((r) => {
        const added = inLibrary(r.itunesId);
        return `<li class="row">
          <img src="${esc(r.thumb)}" alt="" loading="lazy">
          <div class="txt"><strong>${esc(r.title)}</strong><span>${esc([r.artist, r.year].filter(Boolean).join(' · '))}</span></div>
          <button class="pill-btn add-btn${added ? ' done' : ''}" type="button" data-add="${r.itunesId}" ${added ? 'disabled' : ''} aria-label="${added ? `${esc(r.title)} is on your wall` : `Add ${esc(r.title)}`}">${added ? 'Added' : 'Add'}</button>
        </li>`;
      }).join('')
      : message('No albums found', 'Check the spelling, or try the artist’s name.');
  } catch {
    if (seq === searchSeq) searchResults.innerHTML = message('Can’t search right now', 'Check your internet connection and try again.');
  }
}

searchResults.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-add]');
  if (!b) return;
  b.disabled = true;
  b.textContent = 'Adding…';
  const ok = await addAlbum(Number(b.dataset.add));
  b.textContent = ok ? 'Added' : 'Add';
  b.classList.toggle('done', ok);
  b.disabled = ok;
});

// Recently played: albums from the imported history, most recent first.
let suggestions = [];
function recentAlbums() {
  const groups = new Map();
  for (const m of historySources()) {
    for (const [key, e] of Object.entries(m)) {
      let { al: album, ar: artist } = e;
      if (!album) {
        const r = state.history.resolved[key];
        if (!r) continue;
        ({ album, artist } = r);
      }
      const gk = `${src.norm(artist)}|${src.norm(album)}`;
      let g = groups.get(gk);
      if (!g) groups.set(gk, (g = { artist, album, last: 0, counts: new Map() }));
      g.last = Math.max(g.last, e.l);
      g.counts.set(key, Math.max(g.counts.get(key) || 0, e.c));
    }
  }
  const onWall = new Set(state.library.map((a) => `${src.norm(a.artist)}|${src.norm(a.title)}`));
  return [...groups.entries()]
    .map(([gk, g]) => ({ artist: g.artist, album: g.album, last: g.last, plays: [...g.counts.values()].reduce((s, c) => s + c, 0), added: onWall.has(gk) }))
    .sort((a, b) => b.last - a.last)
    .slice(0, 80);
}

function renderRecent() {
  if (!hasHistory()) {
    recentResults.innerHTML = message(
      'No listening history yet',
      'Import your Spotify history or connect Last.fm in Settings. The albums you play will show up here.',
      '<br><button class="pill-btn small" type="button" data-action="settings">Open Settings</button>',
    );
    return;
  }
  suggestions = recentAlbums();
  recentResults.innerHTML = suggestions.length
    ? suggestions.map((s, i) => `<li class="row">${NOTE_ICON}
        <div class="txt"><strong>${esc(s.album)}</strong><span>${esc(s.artist)} · ${plural(s.plays, 'play')} · ${relative(s.last)}</span></div>
        <button class="pill-btn add-btn${s.added ? ' done' : ''}" type="button" data-suggest="${i}" ${s.added ? 'disabled' : ''} aria-label="${s.added ? `${esc(s.album)} is on your wall` : `Add ${esc(s.album)}`}">${s.added ? 'Added' : 'Add'}</button>
      </li>`).join('')
    : message('Finding your albums…', 'This takes a moment the first time.');
  resolveMissingAlbums();
}

recentResults.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-suggest]');
  if (!b) return;
  const s = suggestions[Number(b.dataset.suggest)];
  b.disabled = true;
  b.textContent = 'Adding…';
  let hit = null;
  try { hit = await src.findAlbum(s.artist, s.album); } catch { /* handled below */ }
  if (!hit) {
    // Not an exact match in the catalogue: let the person pick it from a search.
    searchInput.value = `${s.artist} ${s.album}`;
    openAdd('search');
    runSearch();
    return;
  }
  const ok = await addAlbum(hit.itunesId);
  b.textContent = ok ? 'Added' : 'Add';
  b.classList.toggle('done', ok);
  b.disabled = ok;
});

// The shorter Spotify file has no album names, so recent songs are looked up
// in the catalogue a few at a time.
let resolving = false;
async function resolveMissingAlbums() {
  if (resolving) return;
  const pending = historySources()
    .flatMap((m) => Object.entries(m))
    .filter(([key, e]) => !e.al && !(key in state.history.resolved))
    .sort((a, b) => b[1].l - a[1].l)
    .slice(0, 20);
  if (!pending.length) return;
  resolving = true;
  for (const [key, e] of pending) {
    try {
      state.history.resolved[key] = (await src.searchSong(e.ar, e.t)) || false;
    } catch {
      break;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  resolving = false;
  saveHistory();
  if (addSheet.open && !$('#pane-recent').hidden) renderRecent();
}

// ---------- Settings ----------

const settingsSheet = $('#settings-sheet');

function renderSettings() {
  const sp = state.history.spotify;
  const years = [...new Set([sp.first, sp.last].map((ms) => new Date(ms).getFullYear()))].join('–');
  $('#spotify-status').textContent = sp.plays ? `${plural(sp.plays, 'play')} · ${years}` : 'Not imported yet';

  const lf = state.history.lastfm;
  const userInput = $('#lastfm-user');
  const button = $('#lastfm-sync');
  if (!src.lastfmAvailable()) {
    $('#lastfm-status').textContent = 'Coming soon: it will keep up with what you play on Spotify.';
    $('#lastfm-form').hidden = true;
    $('#lastfm-form').nextElementSibling.hidden = true;
  } else {
    if (!userInput.value) userInput.value = lf.user;
    button.textContent = lf.user && lf.user === userInput.value.trim() ? 'Update' : 'Connect';
    $('#lastfm-status').textContent = lf.user
      ? `${plural(lf.plays, 'play')} · updated ${relative(lf.syncedAt)}`
      : 'Keeps up with what you play on Spotify';
  }
  $('#sort-select').value = state.sort;
}

function afterHistoryChange() {
  saveHistory();
  renderSettings();
  if (state.current) renderStats(state.current);
  flow.refreshBack();
}

$('#spotify-file').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  const sp = state.history.spotify;
  let added = 0;
  let skipped = 0;
  try {
    for (const file of files) {
      const id = `${file.name}|${file.size}`;
      if (sp.files.includes(id)) { skipped += 1; continue; }
      const plays = src.parseSpotify(JSON.parse(await file.text()));
      src.aggregate(plays, sp.tracks);
      for (const p of plays) {
        sp.first = sp.first ? Math.min(sp.first, p.ts) : p.ts;
        sp.last = Math.max(sp.last, p.ts);
      }
      sp.plays += plays.length;
      sp.files.push(id);
      added += plays.length;
    }
  } catch (err) {
    toast(err instanceof SyntaxError ? 'That file couldn’t be read. Pick a .json file from Spotify.' : err.message);
  }
  if (added) {
    afterHistoryChange();
    toast(`Imported ${plural(added, 'play')}`);
  } else if (skipped) {
    toast('Those files were already imported');
  }
});

let syncing = false;
async function syncLastfm({ quiet = false } = {}) {
  const user = $('#lastfm-user').value.trim() || state.history.lastfm.user;
  if (!user || syncing || !src.lastfmAvailable()) return;
  syncing = true;
  const status = $('#lastfm-status');
  let lf = state.history.lastfm;
  if (lf.user.toLowerCase() !== user.toLowerCase()) lf = state.history.lastfm = { tracks: {}, user, plays: 0, last: 0, syncedAt: 0 };
  try {
    const plays = await src.fetchLastfm(user, lf.last, (page, pages) => {
      if (!quiet) status.textContent = `Fetching your plays… ${Math.round((page / pages) * 100)}%`;
    });
    src.aggregate(plays, lf.tracks);
    lf.plays += plays.length;
    lf.last = plays.reduce((m, p) => Math.max(m, p.ts), lf.last);
    lf.user = user;
    lf.syncedAt = Date.now();
    store.pref('lastfmUser', user);
    afterHistoryChange();
    if (!quiet) toast(plays.length ? `Added ${plural(plays.length, 'play')} from Last.fm` : 'You’re up to date');
  } catch (err) {
    renderSettings();
    if (!quiet) toast(err.message || 'Couldn’t reach Last.fm. Try again later.');
  } finally {
    syncing = false;
  }
}
$('#lastfm-form').addEventListener('submit', (e) => { e.preventDefault(); syncLastfm(); });

$('#sort-select').addEventListener('change', (e) => {
  state.sort = store.pref('sort', e.target.value);
  refreshWall(state.current?.id);
});

$('#export-btn').addEventListener('click', () => {
  const data = { app: 'spinwall', version: 1, exportedAt: new Date().toISOString(), library: state.library, history: state.history };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `Spinwall backup ${isoDate(Date.now())}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});

$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { data = null; }
  if (!data || data.app !== 'spinwall' || !Array.isArray(data.library)) {
    toast('That isn’t a Spinwall backup');
    return;
  }
  if (!confirm(`Replace your wall with this backup (${plural(data.library.length, 'album')})?`)) return;
  state.library = data.library;
  state.history = { ...emptyHistory(), ...(data.history || {}) };
  saveLibrary();
  saveHistory();
  state.current = null;
  refreshWall();
  renderSettings();
  toast('Backup restored');
});

// ---------- Wiring ----------

// The glass highlight follows the pointer or finger across each surface.
const GLASS = '.icon-btn, .pill-btn, .nav-btn, .glass, .sheet, .toast';
function followLight(e) {
  const el = e.target.closest?.(GLASS);
  if (!el) return;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
  el.style.setProperty('--my', `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
}
document.addEventListener('pointermove', followLight, { passive: true });
document.addEventListener('pointerdown', followLight, { passive: true });

document.querySelectorAll('dialog').forEach((d) => {
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  d.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => d.close()));
});

$('#btn-add').addEventListener('click', () => openAdd(hasHistory() ? 'recent' : 'search'));
$('#btn-settings').addEventListener('click', () => { renderSettings(); settingsSheet.showModal(); });

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const actions = {
    add: () => openAdd('search'),
    demo: () => addClassics(el),
    prev: () => flow.prev(),
    next: () => flow.next(),
    unflip: () => flow.toggleFlip(false),
    settings: () => { addSheet.close(); renderSettings(); settingsSheet.showModal(); },
  };
  actions[el.dataset.action]?.();
});

async function init() {
  const [library, history] = await Promise.all([store.get('library'), store.get('history')]);
  state.library = Array.isArray(library) ? library : [];
  if (history) state.history = { ...emptyHistory(), ...history };
  if (!state.history.lastfm.user) state.history.lastfm.user = store.pref('lastfmUser') || '';
  paint(null);
  refreshWall(store.pref('center'));
  renderSettings();
  // Keep Last.fm plays current without asking, at most once an hour.
  if (state.history.lastfm.user && Date.now() - state.history.lastfm.syncedAt > 3600000) syncLastfm({ quiet: true });
  // Ask the browser not to clear the wall when space runs low.
  navigator.storage?.persist?.().catch(() => {});
}

if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
