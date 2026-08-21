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
src/lib/recommend.js            local strand + career scoring (no network)
netlify/functions/chat.mjs      Anthropic endpoint (holds the API key)
vite.config.js                  build config + /api/chat middleware for `npm run dev`
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

### Strand and career match

The **Career match** tab opens with an eight-question form — seven 1-5 interest
ratings and one activity — scored by `src/lib/recommend.js` **in the browser**.
No network call, no model, no key: the same answers always produce the same
result, and it works offline.

All five strands come back ranked with a match percentage and a reason written
from the student's own answers ("You rated Math (very much), Science (very
much) and Technology (a lot), and those carry the most weight for STEM"),
followed by the careers those answers point to, each with its own percentage,
route badge and reason.

**How the scoring works.** Each strand carries weights over the seven traits —
STEM leans on maths, science and technology; ABM on business, communication and
maths; and so on. A strand's score blends two things:

- **absolute** — how highly the student rated the traits that strand needs
- **relative** — how far those traits sit *above the student's own average*

The second half matters. Someone who rates everything 5 would "fit" every
strand on absolute interest alone, which tells them nothing; the relative term
is what separates a genuine preference from blanket enthusiasm.

**GAS is scored differently on purpose.** It is the strand for students who
have not narrowed down yet, so it rewards an *even* spread rather than a peak:
the flatter and more uniformly interested the answers, the better GAS fits.
Weighting it like the others would make it a weak copy of whichever strand was
nearest.

The eighth question is a nudge worth at most twelve points — enough to separate
two close strands, never enough to overturn seven considered ratings.

Careers score the same way against the traits the work actually uses, then
blend in the fit of the strand they sit under (70/30) so the career list cannot
contradict the strand result. `route` — `degree`, `short` (TESDA or a
certificate) or `work` — is shown as a badge, so a student who cannot go
straight to college can see their options.

**TVL is left to the student.** A TVL result shows the score and a note but no
apply button, because the profile splits TVL into four tracks and picking one
would be inventing an answer the questionnaire did not ask for.

To adjust the starting model, edit the weights in `src/lib/recommend.js` —
`STRANDS[].weights`, `ACTIVITIES[].bonus` and `CAREERS[].weights` are the whole
of it.

### It adapts to the student

Each strand and each career carries **Fits me** / **Not for me**. Feedback is
evidence about that student, so it moves the weights and the next score
reflects it — locally, on that device, with nothing sent anywhere.

The rule is one line of reasoning: *a student who says a job fits is telling us
the traits that job leans on matter more to them than the starting model
assumed, and the evidence is strongest for the traits they themselves rated
highly.* So each weight moves by `rate × signal × their own rating for that
trait`, scaled by how much the job leans on it. "Not for me" moves the same
weights the other way. The job's strand gets half the same movement, because
endorsing one job is partial evidence about its family, not proof.

Three properties keep this safe to hand to a class:

- **The base model is never mutated.** Feedback accumulates as *deltas*, so any
  adjusted weight can be shown as `3.0 → 3.4` and **Reset what it learned**
  is simply deleting them.
- **Weights are bounded** to `[0, 2 × base + 1]`. No amount of clicking lets
  one subject take over or disappear.
- **It stays deterministic.** The same answers and the same feedback always
  give the same result — there is no randomness and no dependence on other
  students.

### Showing your teacher how it works

**Show the maths** opens the worked calculation behind the result:

1. **Trait by trait** for the top strand — a table of each trait, the student's
   1-5 rating, its 0-1 conversion, the weight (with the original beside it if
   feedback has moved it) and the contribution, with the column totals.
2. **The subtotals** — absolute, relative, the blend, the activity bonus and
   the final score, each written out as the sum that produced it.
3. **All five strands** side by side.
4. **The top career** — trait fit, strand fit, the 70/30 blend.
5. **What the feedback changed** — every weight that has moved, with its
   starting value.

Everything shown is recomputable by hand from the numbers on screen. That is
enforced rather than hoped for: `verifyTrace()` re-adds each trace and checks
it reproduces the score it claims to explain, and the test suite runs it over
every strand and career, before and after feedback and at the weight cap. If
the explanation ever drifts from the calculation, the tests fail.

### Career match

Two engines, not one. The **local** engine above scores instantly on the
device; **Match me to careers** additionally asks Anthropic for a set written
around what the student typed in their profile, which is the richer answer
when it is available.

**If Anthropic cannot be reached, the tab does not go empty.** The failure
falls through to `localCareerCards()` — the same scoring as the strand
result, with the student's feedback folded in — rendered in the same cards,
with a note saying where they came from so nobody mistakes offline
suggestions for the personalised ones. Choosing one still drives the resume,
the roadmap and interview prep exactly as an AI suggestion would, and the
banner clears the moment a later match succeeds.

The only case that cannot fall back is a student who has not answered the
eight questions yet; they get a message pointing at the questionnaire rather
than a dead end. `ANTHROPIC_API_KEY` remains the only variable the app needs,
and nothing about the local engine depends on it.

Suggestions are sorted best-fit first, with the path the student chose pinned
to the top. Each card carries a fit label (Strong fit / Good fit / Worth
exploring) and a route badge, and a compare strip above the cards puts all four
fit scores side by side. The model is asked to tag each career with a `route`
of `degree`, `short` (TESDA or a certificate) or `work`, which drives the
"No 4-year degree needed" filter — so the students who cannot go straight to
college can find their options in one click.

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

   That is the only variable the app needs.

4. Deploy. Redeploy after adding the variable if you added it post-build.

## How the API key is protected

The browser never sees the key. It posts to `/api/chat` on your own origin;
Netlify routes that to `netlify/functions/chat.mjs`, which reads the key from
the server environment and calls Anthropic. The browser is therefore never
subject to Anthropic's CORS policy either.

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
