# Healthy Eating

A personal iPhone home-screen web app (PWA) for planning foods, tracking a pantry, and keeping a calm eye on calories. Plain HTML/CSS/vanilla JS, no build step. Version 1.1.

## Features

- **Plan**: a week view with a day picker. Each day has Breakfast, Lunch, Dinner and Snack (peach, mint, lavender, butter-yellow). Add a food with an **amount stepper** (chips ½, 1, 1½, 2, plus −/+ in 0.25 steps). Entries read like `Smoothie · 1½ × 1 smoothie · 689 kcal`. Tick "ate it", set an optional daily goal, copy last week (amounts are kept).
- **Foods**: a food is a single item ("Banana") or a combo ("Smoothie") with a serving description, calories per serving, an optional estimate flag, notes, linked pantry items, and **ingredients & amounts** (name, amount, kcal, optional pantry link). If every ingredient has kcal, the food's calories are their sum, shown live in the editor. "Can make now" uses the pantry items linked to the food plus those linked from its ingredients.
- **Find calories**: next to the calories field and each ingredient's kcal field (see below). Saving a food with no calories offers to look them up; otherwise it is saved with "kcal ?" (counted as 0 in totals, and the day shows "N foods without calories").
- **Pantry / Shopping**: mark items Have or Out; Out items form the shopping list.
- **Starter foods**: on the first launch of v1.1 your starter pantry and foods (`seed-foods.js`) are merged in without touching existing data. Settings > "Add my starter foods" re-runs the merge (skips names already present).
- Always a soft pastel light theme, even if the phone is in dark mode.

## Find calories: data sources

The only network use in the app. Both are queried in parallel with an 8 second timeout; failures show a friendly message.

- **Open Food Facts** (packaged/branded foods): `world.openfoodfacts.org/cgi/search.pl`. Uses `energy-kcal_serving` (per the product's serving size) when present, else `energy-kcal_100g`. Data licence: ODbL.
- **USDA FoodData Central** (generic foods): `api.nal.usda.gov/fdc/v1/foods/search` with the shared `DEMO_KEY` (rate-limited; if it is exhausted the source simply shows as unavailable). Energy in kcal per 100 g; branded foods with a gram/ml serving also get a per-serving value.

Pick a result, choose servings or grams, and "Use N kcal" fills the field (and the serving text / a "Calories from ..." note if those are empty). All remote text is rendered as plain text. The service worker never caches these requests (network only). Values are estimates.

## Run locally

```
python3 -m http.server 8000
# open http://localhost:8000
```

Service workers need `http://localhost` or HTTPS. For a phone, host the folder over HTTPS (for example GitHub Pages; all paths are relative).

## Install on iPhone

1. Open the site in **Safari**, tap **Share**, then **Add to Home Screen**.
2. Launch it from the home screen; it runs full-screen and works offline (lookups need a connection).

## How updates reach the phone

The app shell is cached by a service worker. When you publish a new version (with `VERSION` bumped in `sw.js`, and in `app.js`), the phone fetches it in the background the next time the app opens, but the screen you are looking at is still the old one. **Close the app completely (swipe it away) and reopen it once or twice**; the second launch runs the new version. Your data is migrated automatically on that launch.

## Backup

Everything is stored in this browser's `localStorage` (key `healthyEating.v1`, unchanged across versions). iOS can clear website data for sites you have not used for a long time, and the home-screen app has its own storage separate from Safari, so export a backup regularly.

- **Settings > Export backup** saves `healthy-eating-backup-YYYY-MM-DD.json` (iOS share sheet when available, otherwise a download).
- **Settings > Import backup** validates, shows a summary, and asks before replacing all data. Version 1 backups are migrated on import.
- When v1 data is migrated, the untouched original is kept once under `healthyEating.v1.preV2`.

## Data model (schemaVersion 2)

```
{
  schemaVersion: 2,
  pantry: [{ id, name, category?: string, status: "have" | "out" }],
  foods:  [{ id, name, serving: string, calories: number | null /* kcal per ONE serving */,
             estimate: boolean, notes: string,
             components: [{ id, name, amount: string, calories: number | null, pantryId: string | null }],
             pantryIds: [pantryId] }],
  weeks:  { "YYYY-MM-DD" /* Monday */: { days: { "YYYY-MM-DD": {
             breakfast|lunch|dinner|snack: [
               { id, foodId | customName + customCalories, servings: number /* default 1 */,
                 time?: "HH:MM", eaten: boolean } ] } } } },
  settings: { dailyGoal: number | null, seededFoodsV1: boolean }
}
```

- Food calories = sum of component calories when the food has components and all have numbers; otherwise the manual `calories`.
- Entry kcal = food kcal x servings, rounded to a whole number (custom entries: customCalories x servings).
- Migration v1 to v2 (`migrate()` in `app.js`): `meals` become `foods` (`serving: "1 serving"`, `estimate: false`, `components: []`, `pantryIds` from `ingredientIds`), plan entries get `servings: 1` and `mealId` becomes `foodId`.
- Dates use local time. Deleting a food turns its plan entries into custom entries (amount kept) so history stays intact.

## Files

`index.html`, `styles.css`, `app.js`, `seed-foods.js`, `sw.js`, `manifest.webmanifest`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`.
