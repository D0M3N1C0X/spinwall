// Where the data comes from:
//  - Apple's public iTunes Search API: covers, year, genre, track list (no account needed)
//  - Wikipedia: the short description
//  - Spotify: the streaming-history files people download from their account
//  - Last.fm: recent scrobbles, which can include everything played on Spotify

import { LASTFM_API_KEY } from './config.js';

const ITUNES = 'https://itunes.apple.com';
const region = (navigator.language.split('-')[1] || 'US').toLowerCase();
export const COUNTRY = /^[a-z]{2}$/.test(region) ? region : 'us';

// ---------- Text matching ----------

// Loose form of a title or name, so "OK Computer (Remastered)" matches "OK Computer".
export function norm(s = '') {
  return String(s)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s*[([][^)\]]*[)\]]/g, '')
    .replace(/\s+-\s+.*\b(remaster(ed)?|version|edit|mix|live|mono|stereo|deluxe|edition|anniversary)\b.*$/, '')
    .replace(/\s+(feat|ft)\.?\s.*$/, '')
    .replace(/&/g, ' and ')
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export const trackKey = (artist, track) => `${norm(artist)}|${norm(track)}`;

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

// ---------- Apple catalogue ----------

const artwork = (url, size = 600) => (url || '').replace(/\/\d+x\d+bb\.(jpg|png)$/, `/${size}x${size}bb.jpg`);
const cleanUrl = (url) => (url || '').replace(/\?uo=\d+$/, '');

export async function searchAlbums(term, limit = 25) {
  const q = new URLSearchParams({ term, entity: 'album', limit, country: COUNTRY, lang: 'en_us' });
  const data = await getJSON(`${ITUNES}/search?${q}`);
  return data.results
    .filter((r) => r.collectionType === 'Album' || r.wrapperType === 'collection')
    .map((r) => ({
      itunesId: r.collectionId,
      title: r.collectionName,
      artist: r.artistName,
      year: r.releaseDate ? Number(r.releaseDate.slice(0, 4)) : null,
      trackCount: r.trackCount,
      thumb: artwork(r.artworkUrl100, 120),
    }));
}

const isSingle = (title) => / - (single|ep)$/i.test(title);

async function artistAlbums(artistId, limit = 200) {
  const q = new URLSearchParams({ id: artistId, entity: 'album', limit, country: COUNTRY, lang: 'en_us' });
  return (await getJSON(`${ITUNES}/lookup?${q}`)).results
    .filter((r) => r.wrapperType === 'collection')
    .map((r) => ({
      itunesId: r.collectionId,
      title: r.collectionName,
      artist: r.artistName,
      year: r.releaseDate ? Number(r.releaseDate.slice(0, 4)) : null,
      trackCount: r.trackCount,
      thumb: artwork(r.artworkUrl100, 120),
    }));
}

// Apple's album search ranks singles and soundalikes above famous albums
// ("Blonde Frank Ocean" doesn't find Blonde at all). Searching songs and
// grouping them by album does much better: the albums people actually play
// come first. Album search results follow, and singles/EPs go last.
export async function smartSearch(term) {
  const words = norm(term);
  const songQuery = new URLSearchParams({ term, entity: 'song', limit: 100, country: COUNTRY, lang: 'en_us' });
  const [songs, plain] = await Promise.all([
    getJSON(`${ITUNES}/search?${songQuery}`).then((d) => d.results).catch(() => []),
    searchAlbums(term, 50),
  ]);
  const byAlbum = new Map();
  for (const s of songs) {
    if (!s.collectionId) continue;
    const entry = byAlbum.get(s.collectionId) || {
      n: 0,
      album: {
        itunesId: s.collectionId,
        title: s.collectionName,
        artist: s.collectionArtistName || s.artistName,
        year: s.releaseDate ? Number(s.releaseDate.slice(0, 4)) : null,
        trackCount: s.trackCount,
        thumb: artwork(s.artworkUrl100, 120),
      },
    };
    entry.n += 1;
    byAlbum.set(s.collectionId, entry);
  }
  const fromSongs = [...byAlbum.values()].sort((a, b) => b.n - a.n).map((e) => e.album);
  const seen = new Set();
  const merged = [...fromSongs, ...plain].filter((r) => !seen.has(r.itunesId) && seen.add(r.itunesId));
  const exact = (r) => words === `${norm(r.artist)} ${norm(r.title)}` || words === `${norm(r.title)} ${norm(r.artist)}`;
  return merged
    .map((r, i) => ({ r, score: (exact(r) ? 0 : 1) + (isSingle(r.title) ? 2 : 0) + i / 1000 }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 40)
    .map((x) => x.r);
}

export async function searchSong(artist, track) {
  // A song usually sits on several releases (the album, singles, remixes,
  // greatest hits). The original album is the best guess: not a single, a
  // remix, a compilation or a special edition, and the earliest release.
  const a = norm(artist);
  const t = norm(track);
  const compilation = /\b(greatest hits|best of|hits|collection|essential|anthology|live|karaoke|tribute)\b/i;
  const variant = /\b(remix|edition|deluxe|anniversary|remaster(ed)?|drumless|instrumental)\b/i;
  const pick = (results) => results
    .filter((r) => norm(r.trackName) === t && [r.artistName, r.collectionArtistName].some((n) => n && (norm(n) === a || norm(n).startsWith(`${a} `))))
    .map((r) => ({
      r,
      score: (isSingle(r.collectionName) || norm(r.collectionName) === t ? 2 : 0)
        + (compilation.test(r.collectionName) ? 2 : 0)
        + (variant.test(r.collectionName) ? 1 : 0),
      date: r.releaseDate || '9999',
    }))
    .sort((x, y) => x.score - y.score || x.date.localeCompare(y.date))[0]?.r;
  const search = async (term) => {
    const q = new URLSearchParams({ term, entity: 'song', limit: 50, country: COUNTRY, lang: 'en_us' });
    return (await getJSON(`${ITUNES}/search?${q}`)).results;
  };
  const hit = pick(await search(`${artist} ${track}`)) || pick(await search(track));
  return hit ? { album: hit.collectionName, artist: hit.collectionArtistName || artist } : null;
}

export async function lookupAlbum(itunesId) {
  const q = new URLSearchParams({ id: itunesId, entity: 'song', country: COUNTRY, lang: 'en_us' });
  const data = await getJSON(`${ITUNES}/lookup?${q}`);
  const album = data.results.find((r) => r.wrapperType === 'collection');
  if (!album) throw new Error('Album not found');
  const tracks = data.results
    .filter((r) => r.wrapperType === 'track' && r.kind === 'song')
    .sort((a, b) => (a.discNumber - b.discNumber) || (a.trackNumber - b.trackNumber))
    .map((r) => ({ n: r.trackNumber, disc: r.discNumber, title: r.trackName, ms: r.trackTimeMillis || 0 }));
  return {
    id: `itunes:${album.collectionId}`,
    itunesId: album.collectionId,
    title: album.collectionName,
    artist: album.artistName,
    year: album.releaseDate ? Number(album.releaseDate.slice(0, 4)) : null,
    genre: album.primaryGenreName || '',
    trackCount: album.trackCount || tracks.length,
    durationMs: tracks.reduce((sum, t) => sum + t.ms, 0),
    tracks,
    artwork: artwork(album.artworkUrl100, 600),
    appleMusicUrl: cleanUrl(album.collectionViewUrl),
  };
}

// Best catalogue match for an album name seen in someone's listening history.
// The search ranks some famous albums surprisingly low, so if the first try
// misses, look through the artist's whole discography instead.
export async function findAlbum(artist, title) {
  const a = norm(artist);
  const t = norm(title);
  const pick = (list) => list.find((r) => norm(r.artist) === a && r.title.toLowerCase() === title.toLowerCase())
    || list.find((r) => norm(r.artist) === a && norm(r.title) === t)
    || list.find((r) => norm(r.artist) === a && (norm(r.title).startsWith(t) || t.startsWith(norm(r.title))));
  const first = pick(await searchAlbums(`${artist} ${title}`, 15));
  if (first) return first;
  const q = new URLSearchParams({ term: artist, entity: 'musicArtist', limit: 5, country: COUNTRY, lang: 'en_us' });
  const found = (await getJSON(`${ITUNES}/search?${q}`)).results.find((r) => norm(r.artistName) === a);
  return found ? pick(await artistAlbums(found.artistId)) || null : null;
}

export const spotifyUrl = (album) =>
  `https://open.spotify.com/search/${encodeURIComponent(`${album.artist} ${album.title}`)}`;

// ---------- Wikipedia ----------

export async function fetchBlurb(title, artist) {
  const q = new URLSearchParams({
    action: 'query', list: 'search', srsearch: `${title} ${artist} album`,
    srlimit: 5, format: 'json', origin: '*',
  });
  const search = await getJSON(`https://en.wikipedia.org/w/api.php?${q}`);
  const t = norm(title);
  const a = norm(artist);
  // "In Rainbows" must beat "In Rainbows – From the Basement": pages titled
  // exactly like the album, or "Album (… album)", are tried first.
  const hits = (search.query?.search || [])
    .filter((h) => norm(h.title).includes(t))
    .sort((x, y) => Number(norm(y.title) === t || /\balbum\)$/i.test(y.title)) - Number(norm(x.title) === t || /\balbum\)$/i.test(x.title)));
  for (const hit of hits) {
    const page = await getJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`);
    const text = page.extract || '';
    const loose = norm(text);
    if (page.type === 'disambiguation' || !loose.includes(a) || !/\b(album|ep|mixtape|soundtrack|record)\b/i.test(text)) continue;
    const sentences = text.match(/[^.!?]+[.!?]+["”’)]*(\s|$)/g) || [text];
    let blurb = '';
    for (const s of sentences) {
      if (blurb && (blurb + s).length > 340) break;
      blurb += s;
    }
    return { text: blurb.trim(), url: page.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title)}` };
  }
  return null;
}

// ---------- Listening history ----------
// Plays are folded into one map per source: trackKey → { ar, t, al, c, f, l }
// (artist, track, album, play count, first and last play in ms).

export function aggregate(plays, into = {}) {
  for (const p of plays) {
    if (!p.artist || !p.track) continue;
    const key = trackKey(p.artist, p.track);
    const e = into[key] || (into[key] = { ar: p.artist, t: p.track, al: null, c: 0, f: p.ts, l: p.ts });
    e.c += 1;
    if (p.ts < e.f) e.f = p.ts;
    if (p.ts >= e.l) { e.l = p.ts; if (p.album) e.al = p.album; }
    if (!e.al && p.album) e.al = p.album;
  }
  return into;
}

// Spotify gives two kinds of files: the "extended" history (with album names)
// and the shorter "account data" history (artist and song only).
export function parseSpotify(json) {
  if (!Array.isArray(json)) throw new Error('This doesn’t look like a Spotify history file.');
  const plays = [];
  for (const e of json) {
    if (e && 'master_metadata_track_name' in e) {
      if (!e.master_metadata_track_name || (e.ms_played ?? 0) < 30000) continue;
      plays.push({
        ts: Date.parse(e.ts),
        artist: e.master_metadata_album_artist_name,
        track: e.master_metadata_track_name,
        album: e.master_metadata_album_album_name || null,
      });
    } else if (e && 'trackName' in e && 'artistName' in e) {
      if ((e.msPlayed ?? 0) < 30000) continue;
      plays.push({
        ts: Date.parse(`${e.endTime.replace(' ', 'T')}:00Z`),
        artist: e.artistName,
        track: e.trackName,
        album: null,
      });
    }
  }
  if (!plays.length && json.length) throw new Error('No songs found in this file. Pick the files that start with “Streaming_History”.');
  return plays.filter((p) => Number.isFinite(p.ts));
}

export const lastfmAvailable = () => Boolean(LASTFM_API_KEY);

// Fetches scrobbles newer than `fromMs`, oldest pages last. Capped so a first
// sync of a very long history stays quick; later syncs only fetch what's new.
export async function fetchLastfm(user, fromMs, onProgress, maxPages = 60) {
  const plays = [];
  let page = 1;
  let pages = 1;
  do {
    const q = new URLSearchParams({
      method: 'user.getrecenttracks', user, api_key: LASTFM_API_KEY,
      format: 'json', limit: 200, page,
    });
    if (fromMs) q.set('from', String(Math.floor(fromMs / 1000) + 1));
    const data = await getJSON(`https://ws.audioscrobbler.com/2.0/?${q}`);
    if (data.error) throw new Error(data.error === 6 ? 'We couldn’t find that Last.fm username.' : data.message);
    const rt = data.recenttracks;
    pages = Number(rt['@attr']?.totalPages || 1);
    for (const t of [].concat(rt.track || [])) {
      if (t['@attr']?.nowplaying || !t.date) continue;
      plays.push({ ts: Number(t.date.uts) * 1000, artist: t.artist['#text'], track: t.name, album: t.album?.['#text'] || null });
    }
    onProgress?.(page, Math.min(pages, maxPages));
    page += 1;
  } while (page <= Math.min(pages, maxPages));
  return plays;
}
