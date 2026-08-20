/* ==========================================================
   SmartPath — strand classifier endpoint

   Calls the AutoTrain Decision Tree model. The browser posts the eight
   questionnaire answers here; this function forwards them to AutoTrain and
   normalises the answer, so no credential ever reaches the browser and the
   request is not subject to the model host's CORS policy.

   Request and response shapes below match the working sample from the
   AutoTrain Testing Console verbatim — see README.

   Environment variables:
     AUTOTRAIN_URL      REQUIRED. The prediction endpoint. The fallback below
                        answers 404 {"detail":"Not Found"} — the origin is
                        reachable but has no route there — so it exists only to
                        produce a diagnosable failure rather than a silent one.
                        Set this to the URL your Testing Console posts to.
     AUTOTRAIN_API_KEY  optional — sent as "Authorization: Bearer <key>" when
                        set. The working sample sends no auth header, so this
                        is left unset unless the endpoint turns out to want one.
   ========================================================== */

const DEFAULT_URL = "https://api.autotrain.app/api/autotrain";

/* The model's feature_columns, in the order AutoTrain reports them. */
export const FEATURES = [
  "math_interest",
  "science_interest",
  "business_interest",
  "communication_interest",
  "technology_interest",
  "creative_interest",
  "hands_on_interest",
  "preferred_activity",
];

/* The seven ratings are 1-5 integers; preferred_activity is a category. */
const RATINGS = FEATURES.slice(0, 7);
const RATING_MIN = 1;
const RATING_MAX = 5;

/* Category values for preferred_activity, as the model expects them.

   ⚠ Only "public_speaking" is confirmed — it is the value in the working
   sample. The other six follow the same snake_case convention but have NOT
   been verified against the training data. A decision tree given a category
   it never saw in training will mispredict rather than error, so if these do
   not match your dataset's column values exactly, correct them here and in
   CLASSIFIER_ACTIVITIES in src/SmartPath.jsx. */
export const ACTIVITIES = [
  "solving_math_problems",
  "doing_science_experiments",
  "running_a_business",
  "public_speaking",
  "working_with_computers",
  "drawing_or_designing",
  "building_or_repairing",
];

/* Best-effort rate limit; per serverless instance, not global. */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const seen = hits.get(ip);
  if (!seen || now > seen.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  seen.count += 1;
  return seen.count > MAX_PER_WINDOW;
}

function sweep() {
  if (hits.size < 500) return;
  const now = Date.now();
  for (const [ip, seen] of hits) if (now > seen.resetAt) hits.delete(ip);
}

function validate(body) {
  if (!body || typeof body !== "object") return "Request body must be JSON.";
  const answers = body.answers;
  if (!answers || typeof answers !== "object") return "answers must be an object.";

  for (const key of RATINGS) {
    const v = answers[key];
    if (typeof v !== "number" || !Number.isFinite(v)) return key + " must be a number.";
    if (!Number.isInteger(v) || v < RATING_MIN || v > RATING_MAX) {
      return key + " must be a whole number from " + RATING_MIN + " to " + RATING_MAX + ".";
    }
  }

  const activity = answers.preferred_activity;
  if (typeof activity !== "string" || !activity.trim()) return "preferred_activity must be text.";
  if (!ACTIVITIES.includes(activity)) return "preferred_activity is not one of the listed choices.";

  return null;
}

/* AutoTrain takes one object per row under "data". That alone is the working
   sample, so it is what we send when no model id is configured.

   With a model id there is a genuine unknown: the reply names a model_id and a
   job_id, but the sample request does not carry either, so the Testing Console
   must attach the id somewhere we cannot see. Rather than guess one position,
   try them in turn and keep whichever the endpoint accepts. */
/* The request body is exactly the one confirmed working in the Testing
   Console — one row of the eight feature columns under "data" — and nothing
   varies it. The 404 proved the path was wrong rather than the payload, so
   there is nothing about the body left to negotiate.

   The one URL variation worth keeping is a trailing slash: a FastAPI app with
   redirect_slashes turned off answers a path missing its slash with a flat 404
   rather than a redirect, and a FastAPI 404 is exactly what came back. */
function attemptsFor(answers, baseUrl) {
  const row = {};
  for (const f of FEATURES) row[f] = answers[f];
  const body = { data: [row] };

  const list = [{ label: "the endpoint as configured", url: baseUrl, body }];

  const slashed = withTrailingSlash(baseUrl);
  if (slashed !== baseUrl) {
    list.push({ label: "the same URL with a trailing slash", url: slashed, body });
  }

  return list;
}

function withTrailingSlash(url) {
  try {
    const u = new URL(url);
    if (u.pathname.endsWith("/")) return url;
    u.pathname += "/";
    return u.href;
  } catch (e) {
    return url;
  }
}

/* What a status usually means here, said once, in the caller's terms. This
   sits beside AutoTrain's own message rather than replacing it — the point is
   to say what to do about the reply, not to paraphrase it. */
function readStatus(status, contentType) {
  if (status === 404) {
    const json = /json/i.test(contentType || "");
    const unset = !process.env.AUTOTRAIN_URL;
    return (
      "A 404" + (json ? " with a JSON body" : "") + " means the server answered but has no route " +
      "at that path — so the endpoint URL is wrong, not the questionnaire or the request body. " +
      (unset ? "AUTOTRAIN_URL is not set, so this used the built-in fallback, which is known to answer 404. " : "") +
      "Open your AutoTrain Testing Console with the browser's Network tab recording, run one " +
      "prediction, and copy the URL it actually posts to; then set AUTOTRAIN_URL to that and redeploy."
    );
  }
  if (status === 405) {
    return "A 405 means the path exists but does not take POST — check the method the Testing Console uses.";
  }
  if (status === 422) {
    return "A 422 means the path is right and the body is not — the field names or their types do not match what the model expects.";
  }
  if (status === 401 || status === 403) {
    return "The endpoint wants credentials this deployment does not have. Set AUTOTRAIN_API_KEY if the Testing Console sends a token, or check whether the request must come from a signed-in session.";
  }
  return null;
}

/* Only a 404 earns a second URL: it is the one status meaning "no route here",
   which the trailing-slash variant can answer. Every other refusal is about
   the request or the server, and repeating it would only add noise. */
const RETRYABLE = new Set([404]);

/* Remembered for the life of the instance, so only the first request after a
   cold start pays for the extra round trip. */
let preferredShape = null;

/* How much of a raw upstream body to keep per attempt. Generous on purpose:
   the whole point is that nothing is thrown away before it can be read. */
const RAW_LIMIT = 2000;

/* Say what an upstream reply actually is, in one line.

   AutoTrain sits behind Cloudflare, so a refusal is not necessarily JSON — an
   edge block or an error page arrives as HTML, and dumping 300 characters of
   markup reads as gibberish. Name that case instead of quoting it. */
function upstreamMessage(text, data, contentType) {
  if (data && typeof data === "object") {
    for (const key of ["error", "message", "detail", "details"]) {
      const v = data[key];
      if (typeof v === "string" && v.trim()) return v.trim().slice(0, 300);
      if (v && typeof v === "object") return JSON.stringify(v).slice(0, 300);
    }
    /* JSON, but none of the usual keys — show the object itself. */
    return JSON.stringify(data).slice(0, 300);
  }

  const raw = String(text || "").trim();
  if (!raw) return "";

  if (/^\s*<(!doctype|html)/i.test(raw) || /text\/html/i.test(contentType || "")) {
    const title = raw.match(/<title[^>]*>([^<]*)<\/title>/i);
    const heading = raw.match(/<h1[^>]*>([^<]*)<\/h1>/i);
    const named = (title && title[1]) || (heading && heading[1]) || "";
    return named.trim()
      ? "an HTML page, not JSON — \"" + named.trim().slice(0, 120) + "\""
      : "an HTML page, not JSON (" + raw.length + " characters)";
  }

  return raw.slice(0, 300);
}

/* What the function can see of its own configuration, for the diagnostics
   block. AUTOTRAIN_API_KEY is reported as present-or-absent and never echoed;
   the model id is an identifier rather than a credential — it comes back in
   AutoTrain's own replies — so it is shown in full, which is the only way to
   confirm the deployment really has the value you think it has. */
function envReport() {
  const url = process.env.AUTOTRAIN_URL;
  const key = process.env.AUTOTRAIN_API_KEY;
  return {
    AUTOTRAIN_URL: url
      ? { set: true, value: url }
      : { set: false, using: DEFAULT_URL + " (built-in fallback — known to answer 404)" },
    AUTOTRAIN_API_KEY: key ? { set: true, length: key.length } : { set: false },
    node: typeof process !== "undefined" && process.version ? process.version : "unknown",
  };
}

function headersOf(res) {
  const out = {};
  try {
    for (const [k, v] of res.headers) out[k] = v;
  } catch (e) {
    /* a runtime without an iterable Headers — the status still tells us most */
  }
  return out;
}

/* Turn AutoTrain's prediction into { strand, confidence, ranked }.
   probabilities is an object keyed by class, so it becomes the ranked bars. */
function normalise(data) {
  if (!data || typeof data !== "object") return null;
  if (data.success === false) return null;

  const first = Array.isArray(data.predictions) ? data.predictions[0] : null;
  if (!first || typeof first !== "object") return null;

  const strand = first.predicted_class;
  if (typeof strand !== "string" || !strand.trim()) return null;

  const confidence = typeof first.confidence_score === "number" ? first.confidence_score : null;

  let ranked = [{ label: strand, score: confidence }];
  const probs = first.probabilities;
  if (probs && typeof probs === "object" && !Array.isArray(probs)) {
    const entries = Object.entries(probs)
      .filter(([, v]) => typeof v === "number")
      .map(([label, score]) => ({ label, score }))
      .sort((a, b) => b.score - a.score);
    if (entries.length) ranked = entries;
  }

  return { strand, confidence, ranked, algorithm: data.algorithm || null };
}

export async function handleClassify(body, ip = "local") {
  sweep();
  if (rateLimited(ip)) {
    return { status: 429, body: { error: "too many requests — wait a minute and try again" } };
  }

  const problem = validate(body);
  if (problem) return { status: 400, body: { error: problem } };

  const baseUrl = process.env.AUTOTRAIN_URL || DEFAULT_URL;
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (process.env.AUTOTRAIN_API_KEY) {
    headers.Authorization = "Bearer " + process.env.AUTOTRAIN_API_KEY;
  }
  /* What goes in the trace: identical to what is sent, minus the credential. */
  const shownHeaders = { ...headers };
  if (shownHeaders.Authorization) shownHeaders.Authorization = "Bearer <redacted>";

  let attempts = attemptsFor(body.answers, baseUrl);
  if (preferredShape) {
    const known = attempts.filter((a) => a.label === preferredShape);
    if (known.length) attempts = known.concat(attempts.filter((a) => a.label !== preferredShape));
  }

  /* Every attempt is recorded in full — request as sent, status, response
     headers, and the response body as text exactly as it arrived, before any
     JSON parsing. Failures return this to the caller rather than summarising
     it, so the live error is readable without digging through logs. */
  const trace = [];
  const env = envReport();
  let firstFailure = null;

  for (const attempt of attempts) {
    const url = attempt.url;
    const payload = JSON.stringify(attempt.body);
    const step = {
      shape: attempt.label,
      request: { method: "POST", url, headers: shownHeaders, body: payload },
    };
    trace.push(step);

    console.log(
      "[classify] REQUEST shape=" + attempt.label + " POST " + url +
      "\n  headers: " + JSON.stringify(shownHeaders) +
      "\n  body: " + payload
    );

    let res;
    try {
      res = await fetch(url, { method: "POST", headers, body: payload });
    } catch (e) {
      const message = e && e.message ? e.message : String(e);
      step.outcome = "network-error";
      step.error = message;
      console.error("[classify] NETWORK ERROR shape=" + attempt.label + ": " + message);
      return {
        status: 502,
        body: {
          error: "Could not reach AutoTrain: " + message,
          detail: message,
          upstream_status: null,
          trace,
          env,
        },
      };
    }

    /* Read as text first, always. Parsing is a second, separate step, so a
       reply that is not JSON is still reported word for word. */
    const text = await res.text();
    const contentType = res.headers.get("content-type") || "";
    let data = null;
    let parseError = null;
    try {
      data = JSON.parse(text);
    } catch (e) {
      parseError = e && e.message ? e.message : String(e);
    }

    step.response = {
      status: res.status,
      status_text: res.statusText || "",
      content_type: contentType,
      headers: headersOf(res),
      body_length: text.length,
      body_truncated: text.length > RAW_LIMIT,
      body_text: text.slice(0, RAW_LIMIT),
      json_parsed: parseError === null,
      parse_error: parseError,
    };

    console.log(
      "[classify] RESPONSE shape=" + attempt.label +
      " status=" + res.status + " " + (res.statusText || "") +
      " content-type=" + (contentType || "none") +
      " length=" + text.length +
      (parseError ? " (not JSON: " + parseError + ")" : "") +
      "\n  body: " + text.slice(0, RAW_LIMIT)
    );

    const detail = upstreamMessage(text, data, contentType);

    if (res.ok) {
      const result = normalise(data);
      if (result) {
        step.outcome = "accepted";
        preferredShape = attempt.label;
        console.log("[classify] ACCEPTED shape=" + attempt.label + " -> " + result.strand);
        return { status: 200, body: result };
      }

      /* 2xx, but not a prediction we can read — success:false, an empty body,
         or an edge page served with a 200. The shape may still be at fault, so
         let the ladder carry on. */
      step.outcome = "unreadable";
      firstFailure = firstFailure || {
        status: 502,
        body: {
          error: "AutoTrain replied " + res.status + " but the body held no prediction" +
            (detail ? ": " + detail : "."),
          upstream_status: res.status,
          detail,
        },
      };
      continue;
    }

    step.outcome = "rejected";

    /* The upstream's own words are the message. Only a genuinely empty body
       falls back to a description, and even then the status is named. */
    const headline = detail
      ? "AutoTrain returned " + res.status + ": " + detail
      : "AutoTrain returned " + res.status + " " + (res.statusText || "") + " with an empty body";

    const hint = readStatus(res.status, contentType);

    if (res.status === 401 || res.status === 403) {
      return { status: 502, body: { error: headline, upstream_status: res.status, detail, hint, trace, env } };
    }
    if (res.status === 429) {
      return { status: 429, body: { error: headline, upstream_status: res.status, detail, hint, trace, env } };
    }

    firstFailure = firstFailure || {
      status: 502,
      body: { error: headline, upstream_status: res.status, detail, hint },
    };

    /* Anything other than a complaint about the body means a different shape
       will not help. */
    if (!RETRYABLE.has(res.status)) break;
  }

  /* Every shape was refused. The first refusal is the honest one to report —
     the later ones only differ in where the model id sat. */
  preferredShape = null;
  firstFailure.body.trace = trace;
  firstFailure.body.env = env;
  return firstFailure;
}

/* Netlify Functions (v2) entry point. */
export default async function handler(request, context) {
  if (request.method !== "POST") {
    return Response.json({ error: "use POST" }, { status: 405, headers: { Allow: "POST" } });
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return Response.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const ip =
    (context && context.ip) ||
    request.headers.get("x-nf-client-connection-ip") ||
    request.headers.get("x-forwarded-for") ||
    "unknown";

  const { status, body: payload } = await handleClassify(body, ip);
  return Response.json(payload, { status });
}
