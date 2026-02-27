# Bílasölur – extra specs (Chrome Extension)

Chrome extension that enhances car listings on **bilasolur.is** by adding extra information directly inside listing cards.

## Features

- Adds a small block to each listing card with:
  - **Vél:** horsepower (e.g. `90 horsepower`)
  - **Eldsneyti (inni):** city consumption (e.g. `3.9 l/100km`)
  - **Síðast uppfært:** last updated date (e.g. `2.2.2026`)
- **Rate-friendly loading**
  - Fetches car details gradually (limited concurrency + delay)
  - Uses caching to reduce repeated requests
- **Per-card loading indicator**
- **Toolbar toggle**
  - Click the extension icon to enable/disable
  - Badge shows **`on`** when enabled (hidden when disabled)

## How it works

1. The content script scans the current page (main page, search results, and other listing pages) for links to:
   - `CarDetails.aspx?...`
2. For each unique car link it fetches the details page and extracts:
   - horsepower from the `Vél` section
   - city consumption from `Innanbæjareyðsla ... l/100km`
   - last update from `Síðast uppfært dd.mm.yyyy`
3. The extension injects a small info panel into the nearest listing container on the page.

## Installation (Developer mode)

1. Clone or download this repository.
2. Open Chrome and go to: `chrome://extensions`
3. Enable **Developer mode** (top-right).
4. Click **Load unpacked** and select the project folder (the one containing `manifest.json`).
5. Pin the extension (Puzzle icon → Pin) so you can see the badge.
6. Open:
   - https://bilasolur.is/
   - or a results page like `SearchResults.aspx`
   and you should see extra info appear on each card.

## Files

- `manifest.json` — MV3 manifest
- `background.js` — toolbar icon click toggles ON/OFF, updates badge, broadcasts state to tabs
- `content.js` — DOM scanning, fetch queue, parsing, UI injection, caching, reacts to enable/disable messages
- `styles.css` — UI styles for injected info + loading indicator

## Configuration (optional)

You can tweak values in `content.js` under `CONFIG`:
- `maxConcurrentRequests`
- `requestSpacingMs`
- `cacheTtlMs`

Lower concurrency / higher delay = friendlier to the website.

## Notes / Limitations

- The extension depends on the current bilasolur page structure and Icelandic labels.
- If bilasolur changes their HTML layout or wording, parsers may need updates.

## Disclaimer

This project is not affiliated with, endorsed by, or connected to bilasolur.is.
Use responsibly and avoid aggressive scraping.
