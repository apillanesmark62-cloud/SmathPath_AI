#!/usr/bin/env node
/* ==========================================================
   Probe the real AutoTrain endpoint.

   This sandbox cannot reach api.autotrain.app, so run this from a machine
   that can — your laptop, or the Netlify build shell. It sends the exact
   body the deployed site sends, then tries a few variants, and reports which
   one the API accepts. No mocks: every request here is real.

     npm run probe:autotrain
     npm run probe:autotrain -- --model-id=cdf2edb7-cddd-4abb-9124-93a90d53d3f2
     npm run probe:autotrain -- --url=https://api.autotrain.app/api/autotrain

   Paste the output back and the fix is a one-liner.
   ========================================================== */

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, "").split("=");
    return [k, rest.join("=") || true];
  })
);

const URL_ = args.url || process.env.AUTOTRAIN_URL || "https://api.autotrain.app/api/autotrain";
const MODEL_ID = args["model-id"] || process.env.AUTOTRAIN_MODEL_ID || "";
const API_KEY = args.key || process.env.AUTOTRAIN_API_KEY || "";

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

const variants = [
  { name: "1. exactly what the site sends", url: URL_, body: { data: [ROW] } },
];
if (MODEL_ID) {
  variants.push(
    { name: "2. + model_id at top level", url: URL_, body: { data: [ROW], model_id: MODEL_ID } },
    { name: "3. + model_id inside the row", url: URL_, body: { data: [{ ...ROW, model_id: MODEL_ID }] } },
    { name: "4. + model_id as a query param", url: URL_ + (URL_.includes("?") ? "&" : "?") + "model_id=" + encodeURIComponent(MODEL_ID), body: { data: [ROW] } }
  );
} else {
  console.log("note: no --model-id given, so only the baseline request is tried.");
  console.log("      Re-run with --model-id=<your model id> to test the model-id variants.\n");
}

const headers = { "Content-Type": "application/json" };
if (API_KEY) headers.Authorization = "Bearer " + API_KEY;

console.log("POST " + URL_);
console.log("headers: " + JSON.stringify(headers).replace(/Bearer [^"]+/, "Bearer ***"));
console.log("=".repeat(70));

let win = null;

for (const v of variants) {
  console.log("\n" + v.name);
  console.log("  body: " + JSON.stringify(v.body));
  let res, text;
  const started = Date.now();
  try {
    res = await fetch(v.url, { method: "POST", headers, body: JSON.stringify(v.body) });
    text = await res.text();
  } catch (e) {
    console.log("  NETWORK ERROR: " + (e && e.message ? e.message : e));
    continue;
  }
  const ms = Date.now() - started;
  console.log("  -> HTTP " + res.status + " " + res.statusText + "  (" + ms + "ms)");
  console.log("  -> content-type: " + (res.headers.get("content-type") || "none"));
  console.log("  -> body: " + text.slice(0, 700) + (text.length > 700 ? " …[truncated]" : ""));

  if (res.ok) {
    try {
      const j = JSON.parse(text);
      const p = Array.isArray(j.predictions) ? j.predictions[0] : null;
      if (j.success !== false && p && typeof p.predicted_class === "string") {
        console.log("  ✅ ACCEPTED — predicted_class=" + p.predicted_class + " confidence_score=" + p.confidence_score);
        if (!win) win = v;
      } else {
        console.log("  ⚠ 2xx but not the expected shape (no predictions[0].predicted_class)");
      }
    } catch (e) {
      console.log("  ⚠ 2xx but the body is not JSON");
    }
  }
}

console.log("\n" + "=".repeat(70));
if (win) {
  console.log("WORKING SHAPE: " + win.name);
  if (win.name.startsWith("1")) {
    console.log("The site already sends this, and needs no configuration. If it still");
    console.log("fails when deployed, the difference is the caller and not the body —");
    console.log("read the Netlify function log for classify, which prints both the exact");
    console.log("outgoing request and AutoTrain's verbatim reply.");
  } else {
    console.log("Set AUTOTRAIN_MODEL_ID to this model id in Netlify:");
    console.log("  Site configuration -> Environment variables -> Add a variable");
    console.log("classify.mjs works out the rest — it tries each position for the id and");
    console.log("keeps the one the endpoint accepts, so this variant is already covered.");
    console.log("Redeploy afterwards so the function picks the variable up.");
  }
} else {
  console.log("Nothing was accepted. Paste the output above and I'll work from the real error.");
  process.exitCode = 1;
}
