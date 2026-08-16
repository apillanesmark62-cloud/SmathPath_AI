# SmartPath

AI-powered career guidance and resume builder for Senior High School students
(Philippine K-12 strands: STEM, ABM, HUMSS, GAS, TVL).

Vite + React front end, with a serverless function that holds the Anthropic API
key so it never reaches the browser.

## Project layout

```
index.html                  page shell
src/main.jsx                React entry point
src/SmartPath.jsx           the whole app (UI, styles, logic)
src/index.css               minimal page reset
netlify/functions/chat.mjs  server-side AI endpoint (holds the API key)
vite.config.js              build config + /api/chat middleware for `npm run dev`
netlify.toml                build, routing and header config for Netlify
```

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

4. Deploy. Redeploy after adding the variable if you added it post-build.

## How the API key is protected

The browser never sees a key. It posts to `/api/chat` on your own origin;
Netlify routes that to `netlify/functions/chat.mjs`, which reads
`ANTHROPIC_API_KEY` from the server environment and calls Anthropic.

Two things keep it that way:

- The variable is **not** prefixed with `VITE_`. Vite only inlines `VITE_*`
  variables into the client bundle, so an unprefixed one cannot be bundled.
  Never rename it to `VITE_ANTHROPIC_API_KEY` — that would publish it.
- `.env` is git-ignored.

To confirm after a build, search `dist/` — there should be no key and no
`api.anthropic.com`:

```bash
npm run build && grep -ri "sk-ant\|api.anthropic.com" dist/ ; echo "exit $? (1 = clean)"
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

## Storage

Student work is saved in the browser's `localStorage` under keys prefixed
`smartpath:`. If localStorage is unavailable (private browsing, storage
disabled) the app falls back to in-memory storage and works for that visit
only.

This means data lives on one device and one browser — it does not sync, and
clearing site data erases it. The sign-in is a school-project login for keeping
work separate on a shared device, not real security: passcodes are stored in
plain text in localStorage, so nobody should reuse a real password.
