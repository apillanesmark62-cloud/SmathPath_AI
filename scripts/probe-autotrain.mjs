#!/usr/bin/env node
/* ==========================================================
   Find the AutoTrain prediction endpoint.

   Checks the endpoint compiled into netlify/functions/classify.mjs, and, if it
   is refused, looks for the path that would work.

   Prediction is per training job — /api/autotrain/jobs/<job id>/predict — so
   retraining issues a new id and the compiled-in URL 404s. That is what this
   is for: confirm the endpoint still answers, or find where it moved.

   It runs from a machine that can reach the endpoint — your laptop. Every
   request here is real; nothing is mocked.

     npm run probe:autotrain
     npm run probe:autotrain -- --refresh-token=... --firebase-key=AIza...

   With no arguments it reads .env, so the two values can be checked before
   they are ever typed into Netlify.

   Paste the output back and the fix is one environment variable.
   ========================================================== */

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, "").split("=");
    return [k, rest.join("=") || true];
  })
);

const { DEFAULT_URL } = await import("../netlify/functions/classify.mjs");
const BASE = args.url || process.env.AUTOTRAIN_URL || DEFAULT_URL;

/* Read a local .env if there is one, so the values can be checked before they
   are ever typed into Netlify. Nothing is written and nothing is echoed. */
try {
  const text = await (await import("node:fs/promises")).readFile(new URL("../.env", import.meta.url), "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch (e) {
  /* no .env — flags and the shell environment still apply */
}

const EMAIL = args.email || process.env.AUTOTRAIN_EMAIL || "";
const PASSWORD = args.password || process.env.AUTOTRAIN_PASSWORD || "";
const REFRESH_TOKEN = args["refresh-token"] || process.env.AUTOTRAIN_REFRESH_TOKEN || "";
const FIREBASE_KEY =
  args["firebase-key"] ||
  process.env.AUTOTRAIN_FIREBASE_API_KEY ||
  process.env.AUTOTRAIN_FIREBASE_APIKEY ||
  "";

let API_KEY = args.key || process.env.AUTOTRAIN_API_KEY || "";

const origin = new URL(BASE).origin;
const line = "=".repeat(72);

/* Read a JWT's expiry without verifying it — we only want to know if it is
   already dead, which is the usual reason a pasted token stops working. */
function expiryOf(jwt) {
  try {
    const claims = JSON.parse(Buffer.from(String(jwt).split(".")[1], "base64url").toString("utf8"));
    return typeof claims.exp === "number" ? claims.exp * 1000 : null;
  } catch (e) {
    return null;
  }
}

/* Google's errors: the sentence lives in error.message. */
function explain(text) {
  try {
    const j = JSON.parse(text);
    return (j.error && (j.error.message || JSON.stringify(j.error))) || text.slice(0, 200);
  } catch (e) {
    return String(text || "").slice(0, 200);
  }
}

/* The web API key is public and lives in the AutoTrain app's own bundle, so
   it can be read rather than hunted for in DevTools. */
async function discoverKey() {
  if (FIREBASE_KEY) return FIREBASE_KEY;
  const appUrl = process.env.AUTOTRAIN_APP_URL || "https://autotrain.app/";
  const pattern = /AIza[0-9A-Za-z_-]{35}/;
  try {
    const html = await (await fetch(appUrl)).text();
    let found = html.match(pattern);
    if (!found) {
      const srcs = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)]
        .map((m) => new URL(m[1], appUrl).href)
        .slice(0, 6);
      for (const src of srcs) {
        const js = await (await fetch(src)).text();
        found = js.match(pattern);
        if (found) break;
      }
    }
    if (found) {
      console.log("  firebase key: read from the AutoTrain app (no variable needed)");
      return found[0];
    }
  } catch (e) {
    /* reported below */
  }
  console.log("  ❌ could not read the Firebase API key from " + appUrl);
  console.log("     Set AUTOTRAIN_FIREBASE_API_KEY, or pass --firebase-key=AIza…");
  return "";
}

/* ---- 0. check the credentials before anything else ---------------------- */

async function checkCredentials() {
  console.log(line);
  console.log("0. Credentials");
  console.log(line);

  if (process.env.AUTOTRAIN_API_KEY || process.env.AUTOTRAIN_AUTH) {
    console.log("  AUTOTRAIN_API_KEY: set, but NO LONGER USED — safe to delete in Netlify");
  }

  /* Signing in is the supported route, so try it first. */
  if (EMAIL && PASSWORD) {
    const key = FIREBASE_KEY || (await discoverKey());
    if (!key) return;

    console.log("  signing in as " + EMAIL + "…");
    const endpoint =
      process.env.AUTOTRAIN_SIGNIN_ENDPOINT ||
      "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword";
    let res, text;
    try {
      res = await fetch(endpoint + "?key=" + encodeURIComponent(key), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: EMAIL, password: PASSWORD, returnSecureToken: true }),
      });
      text = await res.text();
    } catch (e) {
      console.log("  ❌ could not reach Firebase: " + (e && e.message ? e.message : e));
      return;
    }

    if (!res.ok) {
      const why = explain(text);
      console.log("  ❌ HTTP " + res.status + " — " + why);
      if (/EMAIL_NOT_FOUND|INVALID_PASSWORD|INVALID_LOGIN_CREDENTIALS/i.test(why)) {
        console.log("     Those are not the credentials AutoTrain knows. Check them by logging in");
        console.log("     to the AutoTrain website with exactly this email and password.");
      } else if (/API_KEY_INVALID|API key not valid/i.test(why)) {
        console.log("     The Firebase API key is wrong. Leave it unset to have it read from the app.");
      } else if (/PASSWORD_LOGIN_DISABLED|OPERATION_NOT_ALLOWED/i.test(why)) {
        console.log("     This account cannot sign in with a password — if you use 'Sign in with");
        console.log("     Google' on AutoTrain, set a password on the account first.");
      }
      return;
    }

    const data = JSON.parse(text);
    const exp = expiryOf(data.idToken);
    console.log("  ✅ signed in" + (exp ? "; token good until " + new Date(exp).toISOString() : ""));
    console.log("     AUTOTRAIN_EMAIL and AUTOTRAIN_PASSWORD are correct. Set them in Netlify and");
    console.log("     the classifier will sign in and renew for itself.");
    API_KEY = data.idToken;
    return;
  }

  if (EMAIL || PASSWORD) {
    console.log("  ❌ " + (EMAIL ? "AUTOTRAIN_PASSWORD" : "AUTOTRAIN_EMAIL") + " is missing — both are needed");
    return;
  }

  if (!REFRESH_TOKEN) {
    console.log("  no login configured. Set AUTOTRAIN_EMAIL and AUTOTRAIN_PASSWORD, or pass");
    console.log("  --email=… --password=… to check them before putting them in Netlify.");
    return;
  }
  if (!FIREBASE_KEY) {
    const found = await discoverKey();
    if (!found) return;
  }

  console.log("  refresh: exchanging the refresh token for a fresh ID token…");
  const endpoint = process.env.AUTOTRAIN_TOKEN_ENDPOINT || "https://securetoken.googleapis.com/v1/token";
  let res, text;
  try {
    res = await fetch(endpoint + "?key=" + encodeURIComponent(FIREBASE_KEY), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: REFRESH_TOKEN }).toString(),
    });
    text = await res.text();
  } catch (e) {
    console.log("  ❌ could not reach the token service: " + (e && e.message ? e.message : e));
    return;
  }

  if (!res.ok) {
    let why = text.slice(0, 300);
    try {
      const j = JSON.parse(text);
      why = (j.error && (j.error.message || JSON.stringify(j.error))) || why;
    } catch (e) {
      /* keep the raw text */
    }
    console.log("  ❌ HTTP " + res.status + " — " + why);
    if (/API_KEY|API key/i.test(why)) {
      console.log("     The Firebase API key is wrong. It is the ?key= value on requests to");
      console.log("     securetoken.googleapis.com or identitytoolkit.googleapis.com, and starts AIza.");
    } else if (/TOKEN_EXPIRED|USER_DISABLED|INVALID_REFRESH_TOKEN|USER_NOT_FOUND/i.test(why)) {
      console.log("     The refresh token is no longer valid. Sign in to AutoTrain again and copy a");
      console.log("     new one from DevTools -> Application -> IndexedDB -> firebaseLocalStorage");
      console.log("     -> your user record -> stsTokenManager -> refreshToken.");
    }
    return;
  }

  const data = JSON.parse(text);
  const token = data.id_token || data.access_token;
  const exp = expiryOf(token);
  console.log("  ✅ minted an ID token" + (exp ? ", good until " + new Date(exp).toISOString() : ""));
  console.log("     Both values are correct. Set them in Netlify and the classifier will renew");
  console.log("     its own token from here on.");
  API_KEY = token;
}

await checkCredentials();
console.log();

/* The exact row from the working Testing Console request. */
const ROW = {
  math_interest: 2,
  science_interest: 1,
  business_interest: 2,
  communication_interest: 5,
  technology_interest: 2,
  creative_interest: 5,
  hands_on_interest: 3,
  preferred_activity: "public_speaking",
};
const BODY = JSON.stringify({ data: [ROW] });

const headers = { "Content-Type": "application/json", Accept: "application/json" };
if (API_KEY) headers.Authorization = "Bearer " + API_KEY;


/* ---------- 1. ask the app for its own route table ---------------------- */

/* FastAPI publishes every route at /openapi.json unless it has been turned
   off. If it answers, this is the whole puzzle solved in one request — no
   guessing required. */
async function routeTable() {
  console.log(line);
  console.log("1. Asking the server for its own route list");
  console.log(line);

  for (const path of ["/openapi.json", "/api/openapi.json", "/docs", "/api/docs"]) {
    const url = origin + path;
    let res, text;
    try {
      res = await fetch(url, { headers: { Accept: "application/json, text/html" } });
      text = await res.text();
    } catch (e) {
      console.log("  GET " + path + " -> network error: " + (e && e.message ? e.message : e));
      continue;
    }
    console.log("  GET " + path + " -> HTTP " + res.status + " (" + text.length + " chars)");
    if (!res.ok) continue;

    if (path.endsWith(".json")) {
      try {
        const spec = JSON.parse(text);
        const paths = spec.paths || {};
        const posts = Object.entries(paths)
          .filter(([, ops]) => ops && ops.post)
          .map(([p, ops]) => "    POST " + p + "   " + (ops.post.summary || ops.post.operationId || ""));
        console.log("\n  ✅ This server documents its routes. Every POST route it has:\n");
        console.log(posts.length ? posts.join("\n") : "    (none)");
        const all = Object.keys(paths);
        if (all.length) {
          console.log("\n  All routes: " + all.join(", "));
        }
        return posts.length ? all : null;
      } catch (e) {
        console.log("    (not parseable as an OpenAPI document)");
      }
    } else {
      console.log("    docs page is reachable — open " + url + " in a browser to read the routes");
    }
  }
  console.log("\n  No route list published. Falling back to trying paths directly.");
  return null;
}

/* ---------- 2. try the paths a prediction endpoint usually lives at ----- */

function candidates() {
  const u = new URL(BASE);
  const basePath = u.pathname.replace(/\/+$/, "");
  const out = [basePath, basePath + "/"];

  /* If the configured path is a per-job predict route, the useful neighbours
     are the other shapes that route might take. */
  const job = basePath.match(/\/jobs\/([^/]+)/);
  if (job) {
    const id = job[1];
    out.push(
      "/api/autotrain/jobs/" + id + "/predict",
      "/api/autotrain/jobs/" + id + "/predictions",
      "/api/autotrain/jobs/" + id,
      "/api/jobs/" + id + "/predict",
      "/api/autotrain/models/" + id + "/predict"
    );
  } else {
    out.push(basePath + "/predict", basePath + "/predictions", "/api/predict", "/predict");
  }
  return [...new Set(out)];
}

async function tryPaths() {
  console.log("\n" + line);
  console.log("2. Posting the real request body to each candidate path");
  console.log(line);
  console.log("  body: " + BODY + "\n");

  const interesting = [];

  const query = new URL(BASE).search;
  for (const path of candidates()) {
    const url = origin + path + query;
    let res, text;
    try {
      res = await fetch(url, { method: "POST", headers, body: BODY });
      text = await res.text();
    } catch (e) {
      console.log("  POST " + path.padEnd(46) + " network error: " + (e && e.message ? e.message : e));
      continue;
    }

    const brief = text.replace(/\s+/g, " ").slice(0, 120);
    console.log("  POST " + path.padEnd(46) + " HTTP " + res.status + "  " + brief);

    /* A 404 means "no such path" and is the only boring answer. Anything else
       — a prediction, a complaint about the body, a demand for a key — means
       the path exists. */
    if (res.status !== 404) {
      interesting.push({ path, url, status: res.status, text });
    }
  }
  return interesting;
}

/* ---------- 3. say what to do about it ---------------------------------- */

const table = await routeTable();
const hits = await tryPaths();

console.log("\n" + line);
console.log("WHAT THIS MEANS");
console.log(line);

const win = hits.find((h) => {
  try {
    const j = JSON.parse(h.text);
    return j.success !== false && Array.isArray(j.predictions) && j.predictions[0] &&
      typeof j.predictions[0].predicted_class === "string";
  } catch (e) {
    return false;
  }
});

if (win) {
  const j = JSON.parse(win.text);
  console.log(win.url + " returned a prediction:");
  console.log("  predicted_class = " + j.predictions[0].predicted_class +
    ", confidence_score = " + j.predictions[0].confidence_score);
  if (win.url === BASE && BASE === DEFAULT_URL) {
    console.log("\nThat is the endpoint already compiled into classify.mjs, so there is");
    console.log("nothing to configure — the classifier should work as deployed.");
  } else {
    console.log("\nSet this in Netlify (Site configuration -> Environment variables), then redeploy:");
    console.log("  AUTOTRAIN_URL = " + win.url);
  }
} else if (hits.length) {
  console.log("No path returned a prediction, but these exist — they answered with");
  console.log("something other than 404, so the route is real and the request is not:\n");
  for (const h of hits) {
    console.log("  " + h.status + "  " + h.url);
    console.log("       " + h.text.replace(/\s+/g, " ").slice(0, 300));
  }
  console.log("\nPaste this section back. A 422 names the fields it wanted; a 401 or 403");
  console.log("means the Testing Console is sending a credential we are not.");
  process.exitCode = 1;
} else {
  console.log("Every path answered 404, so the prediction endpoint is somewhere this");
  console.log("script did not guess" + (table ? " and the route list above did not name" : "") + ".");
  console.log("\nGet it from the source instead — it takes about thirty seconds:");
  console.log("  1. Open your AutoTrain Testing Console in a browser.");
  console.log("  2. Open DevTools (F12) and select the Network tab. Tick 'Preserve log'.");
  console.log("  3. Run one prediction.");
  console.log("  4. Click the request that appears and copy its full Request URL,");
  console.log("     its request headers, and its request payload.");
  console.log("\nThat URL is the value for AUTOTRAIN_URL. Paste all three back and I will");
  console.log("match the function to whatever the console is actually doing.");
  process.exitCode = 1;
}
