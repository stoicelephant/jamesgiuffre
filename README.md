# jamesgiuffre.com

Static personal site. No build step: the files in this folder are the site.

- `index.html`: landing page
- `lights.html`: lights project page
- `tracker.html`: private task board at /tracker (`tracker.js`, `tracker.css`, saved via `api/tasks.js`). Password comes from the `TRACKER_PASSWORD` env var in Vercel. Task photos/videos are stored in chunks via `api/task-files.js`
- `style.css`, `leds.js` (LED panel animation), `site.js`, `favicon.svg`

Media (photos and demo videos) loads from public Google Drive links.
