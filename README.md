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
netlify/functions/classify.mjs  strand classifier endpoint (calls AutoTrain)
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
AutoTrain Decision Tree model. Seven questions are 1-5 interest ratings and the
eighth is a category, matching the model's `feature_columns`:

| Feature | Input |
| --- | --- |
| `math_interest` | rating, 1-5 |
| `science_interest` | rating, 1-5 |
| `business_interest` | rating, 1-5 |
| `communication_interest` | rating, 1-5 |
| `technology_interest` | rating, 1-5 |
| `creative_interest` | rating, 1-5 |
| `hands_on_interest` | rating, 1-5 |
| `preferred_activity` | one of seven categories |

Submitting posts to `/api/classify`, which forwards the answers to AutoTrain
and normalises the reply. The predicted strand is shown with its confidence and
a bar per class from `probabilities`, and can be written to the student's
profile in one click. Answers and result are saved with the rest of their work,
so both survive a reload.

**The wire format.** `netlify/functions/classify.mjs` sends one row under
`data`:

```json
POST https://api.autotrain.app/api/autotrain/jobs/<job id>/predict?access=dashboard
Content-Type: application/json

{ "data": [ { "math_interest": 2, "science_interest": 1, "business_interest": 2,
              "communication_interest": 5, "technology_interest": 2,
              "creative_interest": 5, "hands_on_interest": 3,
              "preferred_activity": "public_speaking" } ] }
```

and reads `predictions[0].predicted_class` and `predictions[0].confidence_score`
from the reply, with `probabilities` becoming the ranked bars. A response
carrying `success: false` is treated as a failure. If the URL's path has no
trailing slash, a 404 is retried once with one — FastAPI with `redirect_slashes`
off answers a missing slash with a flat 404 rather than a redirect.

**Prediction is per training job.** The endpoint is not `/api/autotrain` —
that path answers `404 {"detail":"Not Found"}`, which cost a few rounds to
work out. The real URL, read off the Testing Console's own network traffic,
names the job:

```
POST https://api.autotrain.app/api/autotrain/jobs/<job id>/predict?access=dashboard
```

The job id is the same value AutoTrain returns as `model_id`. It is compiled
into `classify.mjs`, so the classifier needs no configuration — but retraining
issues a **new job id**, and the old URL then 404s. That is the one thing to
expect to have to change: copy the fresh Request URL from the console and set
`AUTOTRAIN_URL`.

`?access=dashboard` is carried through verbatim because the console sends it.
It is a mode flag rather than a credential, but it is also the part most
likely to tie the request to a signed-in dashboard session — so if the
deployed function ever gets a 401 or 403 while the console still works, start
by diffing the request headers. `AUTOTRAIN_API_KEY`, if it comes to that, is
sent as `Authorization: Bearer <key>` from the server side only.

**When AutoTrain refuses the request.** Nothing is summarised away. The error
line is AutoTrain's own words — `AutoTrain returned 400: Missing required
field: api_key` — and **Show the request and reply** underneath opens the full
trace: for every attempt, the URL, the request headers, the exact JSON body
sent, the HTTP status and status text, every response header, and the response
body as text *before* any JSON parsing, plus a note if it did not parse. Above
that sits what the deployed function can see of its own configuration, so
whether `AUTOTRAIN_URL` actually reached the environment is a fact on the
page rather than a guess. **Copy** puts the whole thing on the clipboard.

The same trace goes to the Netlify function log, tagged `[classify] REQUEST`
and `[classify] RESPONSE`.

`AUTOTRAIN_API_KEY` is the one thing never echoed — the trace reports whether
it is set and how long it is, and the header shows as `Bearer <redacted>`. The
model id is not a credential (AutoTrain returns it in its own replies), so it
is shown in full, which is the only way to confirm the value the deployment
actually holds.

A reply that is HTML rather than JSON is named as such, with its `<title>` —
the endpoint sits behind Cloudflare, and an edge block is an HTML page, so
quoting 300 characters of markup would read as noise.

The request body is never varied. The Testing Console's body is known to work,
so `classify.mjs` sends exactly that and nothing else. The only retry is a
trailing slash on a 404, because a FastAPI app with `redirect_slashes` off
answers a missing slash with a flat 404 instead of a redirect.

To hunt for the right path from a machine that can reach the endpoint:

```bash
npm run probe:autotrain
```

It asks the server for its OpenAPI route list, then posts the real body to the
paths a prediction endpoint usually occupies, printing status, headers and body
for each.

**⚠ Activity categories are only partly confirmed.** `preferred_activity` is a
snake_case category. `public_speaking` is verified — it is the value in the
working sample. The other six follow the same convention but have **not** been
checked against the training data. A decision tree given a category it never
saw in training mispredicts silently rather than erroring, so if these differ
from your dataset's column values, correct them in both places:
`ACTIVITIES` in `netlify/functions/classify.mjs` and `CLASSIFIER_ACTIVITIES`
in `src/SmartPath.jsx`. The student sees the `label`; the model receives the
`value`.

**TVL is left to the student.** The model's classes are ABM, GAS, HUMSS, STEM
and TVL, but the profile splits TVL into four tracks (Home Economics, ICT,
Industrial Arts, Agri-Fishery). A `TVL` prediction therefore shows the result
and a note, without an apply button — picking a track for the student would be
inventing an answer the model did not give.

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


   The classifier needs nothing — its endpoint is compiled into
   `classify.mjs`. Set `AUTOTRAIN_URL` when the model is retrained and the job
   id changes, and `AUTOTRAIN_API_KEY` only if the endpoint starts asking for
   one. See **Strand classifier** above.

4. Deploy. Redeploy after adding the variable if you added it post-build.

## How the API key is protected

The browser never sees a key. It posts to `/api/chat` and `/api/classify` on
your own origin; Netlify routes those to `netlify/functions/chat.mjs` and
`netlify/functions/classify.mjs`, which read their credentials from the server
environment and call Anthropic and AutoTrain. Keeping the AutoTrain call
server-side also means the browser is never subject to that host's CORS policy,
and a key can be added later without touching client code.

Two things keep it that way:

- The variable is **not** prefixed with `VITE_`. Vite only inlines `VITE_*`
  variables into the client bundle, so an unprefixed one cannot be bundled.
  Never rename it to `VITE_ANTHROPIC_API_KEY` — that would publish it.
- `.env` is git-ignored.

To confirm after a build, search `dist/` — there should be no key and no
`api.anthropic.com`:

```bash
npm run build && grep -ri "sk-ant\|api.anthropic.com\|Bearer " dist/ ; echo "exit $? (1 = clean)"
```

The string `AUTOTRAIN_API_KEY` *does* appear in the bundle, and that is correct:
the diagnostics panel labels the row that reports whether the key is set. It is
the variable's name, never its value — the value only ever exists in the
serverless function's environment.

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
