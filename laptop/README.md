# Healthy Eating

A personal iPhone home-screen web app (PWA) for planning foods, tracking a pantry, and keeping a calm eye on calories. Plain HTML/CSS/vanilla JS, no build step. Version 1.2.

## Features

- **Menu: Meals and Foods.** The Menu tab has a **Meals | Foods** switch (your last choice is remembered). A **food** is a single item ("Banana", "Smoothie") with a serving, calories, an optional estimate flag, notes, ingredients and linked pantry items. A **meal** is something you compose from foods you often eat together, for example "Toast & apple" = Sourdough toast with butter spread x1 + Apple x1. Each meal line has its own servings stepper (½, 1, 1½, 2 and -/+ in 0.25 steps); the meal's calories are the sum of food calories x servings (a food without calories counts 0 and the meal shows `kcal ?`). Both lists have search and "Can make now". Meal detail shows picture, items, total, status and Edit / Add to plan / Delete. Two starter meals ("Toast & apple", "Rice & milk") are added once on the first v1.2 launch (matched by name, skipped if present).
- **Missing ingredients.** A food is missing when any linked pantry item (including ingredient links) is marked Out; a meal is missing when any of its foods is. Missing foods, meals and plan entries get a distinct rose card with a dashed border, a cart icon and a line like `Pick up: Milk, Bananas` (long lists show `+2 more`). On the Plan, tapping that line opens Shopping. Out items are already on the Shopping list. Entries you have ticked as eaten are shown normally.
- **Plan a week.** Tap the week range ("Oct 26 – Nov 1") to open a month calendar; tapping any date picks that Monday-Sunday week (or use This week / Next week). A **Day | Week** switch toggles the existing day view and a week overview: seven day cards, each with four slot rows showing picture, name, kcal, the day total (and vs goal), missing entries in the rose style. Tap an empty slot or the + to add; tap a day name to jump to Day view. The add picker has **Meals | Foods | Custom**, searchable, can-make items first, then the servings stepper (for a meal it multiplies the whole meal) and an optional time. "Add to plan" on a meal or food in the Menu asks for week (this / next / calendar), day and slot. Copy last week keeps meals, foods and amounts.
- **Pictures.** Every food and meal has a picture: an automatic emoji (keyword map in `emoji.js`; a meal uses its first food's emoji), an emoji you choose from the grid (with keyword search), or a photo. Tap the picture tile in an editor or detail view to change it: "Take or choose photo" (iPhone offers camera or library), an emoji grid, or "Remove photo" (back to the automatic emoji).
- **Find calories**: next to the calories field and each ingredient's kcal field (see below). Saving a food with no calories offers to look them up; otherwise it is saved with "kcal ?" (counted as 0 in totals, and the day shows "N items without calories").
- **Pantry / Shopping**: mark items Have or Out; Out items form the shopping list.
- **Starter foods**: foods and pantry items (`seed-foods.js`) are merged on first launch of v1.1, starter meals on first launch of v1.2, without touching existing data. Settings > "Add my starter foods" re-runs both merges (skips names already present).
- Always a soft pastel light theme, even if the phone is in dark mode.

## Photos: where they are stored

Photos are resized on the device (centre-cropped square, 320 x 320 JPEG, quality 0.8, about 20 to 40 KB) and stored in **IndexedDB** (database `healthyEating`, store `photos`), not in localStorage, so they do not fill its ~5 MB limit. If IndexedDB is unavailable, a photo under 60 KB is kept in localStorage instead; otherwise the app says "Couldn't save photo". A photo is deleted when it is replaced or removed, or when its food or meal is deleted. Backups include photos (see Backup).

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

Foods, meals, pantry and plans are in this browser's `localStorage` (key `healthyEating.v1`, unchanged across versions); photos are in IndexedDB. iOS can clear website data for sites you have not used for a long time, and the home-screen app has its own storage separate from Safari, so export a backup regularly.

- **Settings > Export backup** saves `healthy-eating-backup-YYYY-MM-DD.json` (iOS share sheet when available, otherwise a download). It includes meals and a `photos` map of dataURLs (about 30 to 40 KB each; Settings shows the approximate size).
- **Settings > Import backup** validates, shows a summary, and asks before replacing all data and photos. v1 and v2 backups are migrated on import.
- Before the first migration the untouched originals are kept once: `healthyEating.v1.preV2` (v1 data) and `healthyEating.v1.preV3` (anything older than v3).

## Data model (schemaVersion 3)

```
{
  schemaVersion: 3,
  pantry: [{ id, name, category?: string, status: "have" | "out" }],
  foods:  [{ id, name, serving, calories: number | null /* kcal per ONE serving */, estimate, notes,
             components: [{ id, name, amount, calories, pantryId }], pantryIds: [pantryId],
             picture: { type: "emoji", value } | { type: "photo", id } }],
  meals:  [{ id, name, notes, picture,
             items: [{ id, foodId, servings } | { id, customName, customCalories, servings } /* left behind by a deleted food */] }],
  weeks:  { "YYYY-MM-DD" /* Monday */: { days: { "YYYY-MM-DD": {
             breakfast|lunch|dinner|snack: [
               { id, kind: "food" | "meal" | "custom", foodId? | mealId? | customName + customCalories,
                 servings: number, time?: "HH:MM", eaten: boolean } ] } } } },
  settings: { dailyGoal: number | null, seededFoodsV1: boolean, seededMealsV1: boolean }
}
```

- Food calories = sum of component calories when all have numbers; otherwise the manual `calories`. Meal calories = sum of food calories x item servings. Entry kcal = (food or meal kcal) x servings, rounded (custom: customCalories x servings).
- Migration v2 to v3 (in `normalize()`): `meals: []`, every entry gets `kind` (`foodId` becomes food, custom stays custom), every food gets an automatic emoji picture, and `seededMealsV1` is false so the starter meals are added once. v1 data still migrates v1 to v2 to v3.
- Dates use local time. Deleting a food turns its plan entries and meal lines into custom lines (name, calories and servings kept); deleting a meal turns its plan entries into custom entries.

## Files

`index.html`, `styles.css`, `app.js`, `seed-foods.js`, `emoji.js`, `sw.js`, `manifest.webmanifest`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`.
