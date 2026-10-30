# Healthy Eating

A personal, offline-first iPhone home-screen web app (PWA) for planning meals, tracking a pantry, and keeping a calm eye on calories. Plain HTML/CSS/vanilla JS, no build step, no network requests.

## Run locally

```
cd work
python3 -m http.server 8000
# open http://localhost:8000
```

Service workers need `http://localhost` or HTTPS. For testing on a phone, host the folder over HTTPS (for example GitHub Pages; all paths are relative so a subpath works).

## Install on iPhone

1. Open the site in **Safari**.
2. Tap **Share** then **Add to Home Screen**, then **Add**.
3. Launch it from the home screen; it runs full-screen and works offline.

Updating: bump `VERSION` in `sw.js` (and `VERSION` in `app.js`) whenever any shell file changes, so installed copies fetch the new files on next launch (it may take one extra launch to take effect).

## Backup

Everything is stored in this browser's `localStorage` on the device (key `healthyEating.v1`). iOS can clear website data for sites you have not used for a long time, and the home-screen app has its own storage separate from Safari, so export a backup regularly.

- **Settings > Export backup** saves `healthy-eating-backup-YYYY-MM-DD.json` (using the iOS share sheet when available, otherwise a download).
- **Settings > Import backup** validates the file, shows a summary, and asks before replacing all current data.
- Moving from Safari to the home-screen app does not carry data over; export from one, import into the other.

## Data model

```
{
  schemaVersion: 1,
  pantry:  [{ id, name, category?: string, status: "have" | "out" }],
  meals:   [{ id, name, calories: number, ingredientIds: [pantryId], notes?: string }],
  weeks:   { "YYYY-MM-DD" /* Monday */: { days: { "YYYY-MM-DD": {
              breakfast|lunch|dinner|snack: [
                { id, mealId | customName + customCalories, time?: "HH:MM", eaten: boolean } ] } } } },
  settings: { dailyGoal: number | null }
}
```

Dates use local time. Deleting a meal converts its plan entries into custom entries so history stays intact. Exports also include `exportedAt`.

## Files

`index.html`, `styles.css`, `app.js`, `sw.js`, `manifest.webmanifest`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`.
