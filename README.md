# Spinwall

Your listened albums, on a wall you can flip through. Cover Flow for iPhone, iPad and Mac.

This folder is the **web app**: it runs today in Safari and installs to the Home Screen.
The native SwiftUI app (App Store, Apple Music, iCloud sync) follows once a Mac that runs Xcode 26 is available.

## Open it

- **Online:** https://d0m3n1c0x.github.io/spinwall/ — open it in Safari and add it to the Home Screen.
- **On your computer:** from this folder run `python3 -m http.server 8642` and open `http://localhost:8642`.

## What it does

- **Cover Flow**: drag, swipe, trackpad, arrow keys, or tap a side cover. The backdrop takes its colours from the centred cover.
- **Turn the cover over** (tap it, press Enter, or use *Show songs*) to see the track list, with links to Apple Music and Spotify.
- **Your notes**: star rating, the date you listened, a free note.
- **Your listening**: play counts, most-played song, first and last play, from your imported history.
- **About this album**: two or three sentences from Wikipedia.
- **Add albums** by searching the catalogue, or from *Recently played* in your history.
- **Backup**: save the wall to a file and open it on another device.

Everything is stored on the device (IndexedDB). There are no accounts and no server.

## Data sources

| What | Source | Account needed |
|---|---|---|
| Covers, year, genre, track list | iTunes Search API | No |
| Description | Wikipedia REST API | No |
| Spotify history | The JSON files from Spotify's privacy page | The user requests them |
| Last.fm scrobbles (coming soon) | Last.fm API, `user.getRecentTracks` | A free API key in `js/config.js`, empty today |

Spotify's Web API is not used for login on purpose. Since 2025 an app in development mode allows only 5 users, and extended access requires a registered business with 250k monthly users.

Search note: Apple's album search ranks singles above famous albums. `smartSearch` searches songs instead, groups them by album, and puts full albums first.

## Files

```
index.html            page structure
styles.css            look and layout
js/coverflow.js       the 3D wall: layout, physics, input
js/app.js             screens, saving, statistics, settings
js/sources.js         catalogue, Wikipedia, Spotify and Last.fm parsing
js/store.js           IndexedDB storage
js/config.js          Last.fm key
sw.js                 offline cache
```

## Porting to SwiftUI

| Web | SwiftUI |
|---|---|
| `CoverFlow` (pos, spring, drag) | `ScrollView(.horizontal)` + `.scrollTargetBehavior(.viewAligned)` + `.visualEffect { rotation3DEffect }` |
| Card flip | `rotation3DEffect(.degrees(180))` with two faces |
| `extractColors` | `CIAreaAverage` on the top and bottom halves of the artwork |
| IndexedDB `library` | SwiftData `@Model Album`, synced with CloudKit |
| iTunes Search | Same API via `URLSession`. With the Developer Program, MusicKit `MusicCatalogSearchRequest` |
| Apple Music listening | MusicKit library and recently played (new in the native app) |
| Spotify files, Last.fm | Same parsing in Swift, `fileImporter` for the JSON files |

The album model to keep: `id, itunesId, title, artist, year, genre, trackCount, durationMs, tracks[{n, disc, title, ms}], artwork, appleMusicUrl, addedAt, rating, note, listenedOn, blurb{text, url}`.

## Licence

MIT, see [LICENSE](LICENSE).
