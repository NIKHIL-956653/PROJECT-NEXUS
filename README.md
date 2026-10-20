# Project Nexus — installable build

Voice-first project log. Speak a note, it files itself to the project you have
locked, and everything stays in your browser's localStorage.

## Files

```
index.html             app shell
styles.css             design tokens + all UI
app.js                 state, voice engine, history, deletes, alerts
sw.js                  service worker (offline shell + font cache)
manifest.webmanifest   install metadata, shortcuts
icons/                 192, 512, maskable 512, apple-touch, favicon
```

No build step, no dependencies. Only external request is the Google Fonts
stylesheet (Orbitron / Rajdhani / JetBrains Mono); the service worker caches it,
so after one online load the app renders fully offline.

## Run it

Service workers and the Web Speech API need an origin, so `file://` will not do.

```bash
# local
python3 -m http.server 8080      # then open http://localhost:8080

# deploy (any static host)
vercel deploy --prod             # or GitHub Pages, Netlify, S3+CloudFront
```

Open it in Chrome, Edge or Safari, allow the microphone once, then install from
the address-bar icon (desktop) or **Add to Home Screen** (mobile).

## How it works

- **Capture** — the mic button starts continuous recognition. Final segments
  stream into the capture field; the whole buffer commits as one entry when you
  stop. `Alt+M` toggles the mic, `Ctrl/Cmd+Enter` logs a typed entry.
- **Confidence** — Chrome reports a per-segment confidence; the entry stores the
  average. Where the engine reports nothing, the entry shows no figure rather
  than a fabricated one.
- **History** — `/` jumps to search. Filter by project, flip **VOICE ONLY**, click
  an entry to expand it.
- **Deleting** — swipe an entry left (touch), right-click it (desktop), or use
  **SELECT** for bulk. Every delete offers a 5-second undo. **Auto-delete after
  10 days** is per project and runs at startup; that one is permanent.
- **Alerts** — a project untouched for 3+ days raises a holographic alert on
  open, and after 7 days it escalates. Enable system notifications with the bell
  to get them outside the app.
- **Offline** — the shell and fonts are cached; typed entries work offline.
  Speech recognition itself goes through the browser's cloud service, so voice
  needs a connection.

## Tuning

Top of `app.js`:

```js
var IDLE_DAYS  = 3;    // when a project starts nagging
var CLEAN_DAYS = 10;   // auto-cleanup window
var UNDO_MS    = 5000; // undo window
```

Palette and type live in the `:root` block at the top of `styles.css`.
Bump `VERSION` in `sw.js` on each deploy to roll the cache.

## Data

Everything is in `localStorage` under `nexus.state.v1` — nothing leaves the
device. Clearing site data clears the log, so export anything you care about
before wiping the browser.
