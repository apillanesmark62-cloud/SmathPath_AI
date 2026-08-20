# SmartPath

AI-powered career guidance and resume builder for Senior High School students
(Philippine K-12 strands: STEM, ABM, HUMSS, GAS, TVL).

Vite + React front end, with a serverless function that holds the Anthropic API
key so it never reaches the browser.

## Project layout

```
index.html                      page shell
src/main.jsx                    React entry point
src/SmartPath.jsx               the whole app (UI, styles, logic)
src/data/places.js              Philippine cities, provinces and schools
src/index.css                   minimal page reset
netlify/functions/chat.mjs      Anthropic endpoint (holds the API key)
netlify/functions/classify.mjs  strand classifier endpoint (holds the HF token)
vite.config.js                  build config + /api/* middleware for `npm run dev`
netlify.toml                    build, routing and header config for Netlify
```

## Features

### Dark mode

The switch sits in the app header — beside the wordmark at the top of the
sidebar on desktop, and in the top bar on phones — so it is reachable from
every tab. The choice is saved per device under `smartpath:theme` and survives
sign-out; on a first visit the app follows the operating system's
`prefers-color-scheme`.

Dark mode is driven entirely by CSS custom properties — `data-theme="dark"` on
the root swaps a block of tokens and no layout rule is duplicated. When adding
styles, use the tokens rather than literal colours:

| Token | Use it for |
| --- | --- |
| `--ink`, `--ink-soft` | text |
| `--paper`, `--card` | page and card surfaces |
| `--panel`, `--on-panel` | the navy panel that stays dark in both themes (rail, hero, primary buttons) |
| `--line`, `--track`, `--chip` | borders, meter tracks, chip fills |
| `--warm-*`, `--err-*` | notice and error blocks |

The resume preview is deliberately exempt — it renders as a white sheet with
dark text in both themes, because it is a preview of a printed page.

### City and school pickers

The **City or province** and **School** fields on the profile and resume forms
are comboboxes: click one and the whole list opens, typing narrows it, and
arrow keys plus Enter work. Picking a city re-sorts the school list so that
city's schools come first.

Anything not on a list can still be typed in freely, and is saved as typed.
That matters, because `src/data/places.js` holds all 227 Philippine cities and
provinces but only ~190 senior high schools and universities — the country has
thousands, so the school list is a shortcut, not a registry. Add entries to
`PH_SCHOOLS` under the matching city group to extend it.

Two cities are named San Fernando, so both are listed under their official
name with the province in brackets — `City of San Fernando (La Union)` and
`City of San Fernando (Pampanga)` — and each has its own school group. They
sort under "C", but typing "san fernando" finds either one.

### Career match

Suggestions are sorted best-fit first, with the path the student chose pinned
to the top. Each card carries a fit label (Strong fit / Good fit / Worth
exploring) and a route badge, and a compare strip above the cards puts all four
fit scores side by side. The model is asked to tag each career with a `route`
of `degree`, `short` (TESDA or a certificate) or `work`, which drives the
"No 4-year degree needed" filter — so the students who cannot go straight to
college can find their options in one click.

### Strand classifier

The **Career match** tab opens with an eight-question form scored by the
AutoTrain model on Hugging Face. Seven questions are 1-5 interest ratings and
the eighth is a category, matching the model's features:

| Feature | Input |
| --- | --- |
| `math_interest` | rating, 1-5 |
| `science_interest` | rating, 1-5 |
| `business_interest` | rating, 1-5 |
| `communication_interest` | rating, 1-5 |
| `technology_interest` | rating, 1-5 |
| `creative_interest` | rating, 1-5 |
| `hands_on_interest` | rating, 1-5 |
| `preferred_activity` | one of seven activities |

Submitting posts to `/api/classify`, which adds the Hugging Face token
server-side and calls the model. The predicted strand is shown with its
confidence and a ranked bar for each label, and can be written to the
student's profile in one click. Answers and the result are saved with the rest
of their work, so both survive a reload.

Configure it with `HF_CLASSIFIER_URL`, `HF_API_TOKEN` and optionally
`HF_CLASSIFIER_FORMAT` (see `.env.example`). Until those are set the form
renders and validates but returns "the classifier is not configured yet"
instead of a prediction — the rest of SmartPath is unaffected.

**Response shapes.** Hugging Face returns different shapes per task, so
`netlify/functions/classify.mjs` normalises `[{label, score}]`,
`[[{label, score}]]`, `{predictions: [...]}` and a bare `["STEM"]` into one
`{ strand, confidence, ranked }` result. A cold serverless model answers `503`
with an estimated load time; the function waits and retries once.

**Keep in step.** The `FEATURES` and `ACTIVITIES` lists in
`netlify/functions/classify.mjs` and the `CLASSIFIER_QUESTIONS` /
`CLASSIFIER_ACTIVITIES` lists in `src/SmartPath.jsx` describe the same model
inputs. If the model is retrained with different features or activity labels,
change both.

## Running it locally

```bash
npm install
cp .env.example .env        # then paste your Anthropic API key into .env
npm run dev                 # http://localhost:5173
```

`npm run dev` serves the app and runs `/api/chat` through the same handler
Netlify uses in production, so local behaviour matches the deployed site.

Without a key the UI still runs — every AI action shows "the server is not
configured yet" instead of an answer.

Other commands:

```bash
npm run build      # production build into dist/
npm run preview    # serve dist/ (static only — /api/chat is not available here)
```

## Deploying to Netlify

1. Push this repository to GitHub.
2. In Netlify, **Add new site → Import an existing project**, and pick the repo.
   `netlify.toml` already sets the build command (`npm run build`), the publish
   directory (`dist`) and the functions directory, so the defaults it offers
   should need no changes.
3. Go to **Site configuration → Environment variables** and add:

   | Key | Value |
   | --- | --- |
   | `ANTHROPIC_API_KEY` | your key from console.anthropic.com |
   | `HF_CLASSIFIER_URL` | your AutoTrain model's inference URL |
   | `HF_API_TOKEN` | a Hugging Face access token |
   | `HF_CLASSIFIER_FORMAT` | `tabular` (default) or `text` |

4. Deploy. Redeploy after adding the variable if you added it post-build.

## How the API key is protected

The browser never sees a key. It posts to `/api/chat` and `/api/classify` on
your own origin; Netlify routes those to `netlify/functions/chat.mjs` and
`netlify/functions/classify.mjs`, which read `ANTHROPIC_API_KEY` and
`HF_API_TOKEN` from the server environment and call Anthropic and Hugging Face.

Two things keep it that way:

- The variable is **not** prefixed with `VITE_`. Vite only inlines `VITE_*`
  variables into the client bundle, so an unprefixed one cannot be bundled.
  Never rename it to `VITE_ANTHROPIC_API_KEY` — that would publish it.
- `.env` is git-ignored.

To confirm after a build, search `dist/` — there should be no key and no
`api.anthropic.com`:

```bash
npm run build && grep -ri "sk-ant\|hf_\|api.anthropic.com\|huggingface" dist/ ; echo "exit $? (1 = clean)"
```

The endpoint also pins the model server-side, validates the request shape, caps
message count and length, and applies a best-effort per-IP rate limit. That
limit is per serverless instance, not global — if the site gets real traffic,
move it to a shared store or Netlify's own rate limiting.

## Model configuration

Set at the top of `netlify/functions/chat.mjs`:

```js
const MODEL = "claude-opus-5";
const MAX_TOKENS = 4000;
const EFFORT = "low";   // low | medium | high | xhigh | max
```

`EFFORT` trades speed against depth. `low` keeps the app responsive and is
plenty for these prompts; raise it if you want more considered answers.

## Layout notes

`.sp-tabbar` (the phone tab bar) must stay declared **before** the
`@media(min-width:900px)` block that hides it. CSS media queries add no
specificity, so a later plain `.sp-tabbar{display:flex}` wins on source order
and the tab bar reappears on desktop, floating over the sidebar and the page
content. If you add tab-bar rules, add them in that same block.

## Storage

Student work is saved in the browser's `localStorage` under keys prefixed
`smartpath:` (the theme choice included). If localStorage is unavailable (private browsing, storage
disabled) the app falls back to in-memory storage and works for that visit
only.

This means data lives on one device and one browser — it does not sync, and
clearing site data erases it. The sign-in is a school-project login for keeping
work separate on a shared device, not real security: passcodes are stored in
plain text in localStorage, so nobody should reuse a real password.
