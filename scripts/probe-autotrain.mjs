#!/usr/bin/env node
/* ==========================================================
   Find the AutoTrain prediction endpoint.

   The deployed site posts to https://api.autotrain.app/api/autotrain and gets

     HTTP 404  {"detail":"Not Found"}

   which is Starlette/FastAPI's stock 404 — the server answered, and it has no
   route at that path. The request body was never the problem, so this script
   looks for the path that does exist rather than reshaping the body.

   It runs from a machine that can reach the endpoint — your laptop. Every
   request here is real; nothing is mocked.

     npm run probe:autotrain
     npm run probe:autotrain -- --url=https://api.autotrain.app/api/autotrain

   Paste the output back and the fix is one environment variable.
   ========================================================== */

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, "").split("=");
    return [k, rest.join("=") || true];
  })
);

const BASE = args.url || process.env.AUTOTRAIN_URL || "https://api.autotrain.app/api/autotrain";
const API_KEY = args.key || process.env.AUTOTRAIN_API_KEY || "";

const origin = new URL(BASE).origin;

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

const line = "=".repeat(72);

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
  const basePath = new URL(BASE).pathname.replace(/\/+$/, "");
  const out = [
    basePath,
    basePath + "/",
    basePath + "/predict",
    basePath + "/predictions",
    basePath + "/inference",
    basePath + "/infer",
    "/api/predict",
    "/api/predictions",
    "/api/inference",
    "/predict",
  ];
  return [...new Set(out)];
}

async function tryPaths() {
  console.log("\n" + line);
  console.log("2. Posting the real request body to each candidate path");
  console.log(line);
  console.log("  body: " + BODY + "\n");

  const interesting = [];

  for (const path of candidates()) {
    const url = origin + path;
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
  console.log("Found it. " + win.url + " returned a prediction:");
  console.log("  predicted_class = " + j.predictions[0].predicted_class +
    ", confidence_score = " + j.predictions[0].confidence_score);
  console.log("\nSet this in Netlify (Site configuration -> Environment variables), then redeploy:");
  console.log("  AUTOTRAIN_URL = " + win.url);
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
