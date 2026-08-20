/* ==========================================================
   SmartPath — strand classifier endpoint

   Calls the AutoTrain Decision Tree model. The browser posts the eight
   questionnaire answers here; this function forwards them to AutoTrain and
   normalises the answer, so no credential ever reaches the browser and the
   request is not subject to the model host's CORS policy.

   Request and response shapes below match the working sample from the
   AutoTrain Testing Console verbatim — see README.

   Environment variables:
     AUTOTRAIN_URL      optional — defaults to the project's endpoint below.
     AUTOTRAIN_API_KEY  optional — sent as "Authorization: Bearer <key>" when
                        set. The working sample sends no auth header, so this
                        is left unset unless the deployment starts requiring
                        one.
     AUTOTRAIN_MODEL_ID optional — the model to score against. /api/autotrain is
                        a shared endpoint and its reply echoes a model_id, so a
                        request that does not name a model may be rejected.
                        Where the id belongs in the request is not documented,
                        so when this is set the function tries each plausible
                        position in turn (top level, inside the row, query
                        string) and uses the first one the endpoint accepts,
                        remembering it for later requests. Unset by default:
                        the request then matches the working sample exactly.
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
function attemptsFor(answers) {
  const row = {};
  for (const f of FEATURES) row[f] = answers[f];

  const modelId = process.env.AUTOTRAIN_MODEL_ID;
  if (!modelId) return [{ label: "data only", body: { data: [row] } }];

  return [
    { label: "model_id at top level", body: { data: [row], model_id: modelId } },
    { label: "model_id inside the row", body: { data: [{ ...row, model_id: modelId }] } },
    { label: "model_id as a query parameter", query: modelId, body: { data: [row] } },
    { label: "data only", body: { data: [row] } },
  ];
}

function withModelQuery(url, modelId) {
  try {
    const u = new URL(url);
    u.searchParams.set("model_id", modelId);
    return u.href;
  } catch (e) {
    return url;
  }
}

/* A rejection worth retrying with a different shape — the endpoint understood
   us and disliked the body. Auth, rate limits and server faults are not about
   shape, so those stop the ladder immediately. */
const SHAPE_ERRORS = new Set([400, 404, 415, 422]);

/* Remembered for the life of the instance, so only the first request after a
   cold start pays for the search. */
let preferredShape = null;

/* Pull whatever the upstream said out of its reply so the cause is visible
   instead of being buried in the function log. Truncated, and this endpoint
   takes no credentials, so there is nothing sensitive to echo. */
function upstreamMessage(text, data) {
  if (data && typeof data === "object") {
    for (const key of ["error", "message", "detail", "details"]) {
      const v = data[key];
      if (typeof v === "string" && v.trim()) return v.trim().slice(0, 300);
      if (v && typeof v === "object") return JSON.stringify(v).slice(0, 300);
    }
  }
  return String(text || "").trim().slice(0, 300);
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
  const headers = { "Content-Type": "application/json" };
  if (process.env.AUTOTRAIN_API_KEY) {
    headers.Authorization = "Bearer " + process.env.AUTOTRAIN_API_KEY;
  }

  let attempts = attemptsFor(body.answers);
  if (preferredShape) {
    const known = attempts.filter((a) => a.label === preferredShape);
    if (known.length) attempts = known.concat(attempts.filter((a) => a.label !== preferredShape));
  }

  let firstFailure = null;

  for (const attempt of attempts) {
    const url = attempt.query ? withModelQuery(baseUrl, attempt.query) : baseUrl;
    const payload = JSON.stringify(attempt.body);
    console.log("AutoTrain request [" + attempt.label + "] ->", url, payload);

    let res;
    try {
      res = await fetch(url, { method: "POST", headers, body: payload });
    } catch (e) {
      const detail = e && e.message ? e.message : String(e);
      console.error("AutoTrain request failed:", detail);
      return {
        status: 502,
        body: { error: "could not reach the classifier", detail: detail.slice(0, 300) },
      };
    }

    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (e) {
      /* handled below — an unparseable body is reported verbatim */
    }

    if (res.ok) {
      const result = normalise(data);
      if (result) {
        preferredShape = attempt.label;
        return { status: 200, body: result };
      }

      /* 200 with a body we cannot read. If it says success:false the request
         shape may still be the problem, so let the ladder continue. */
      console.error("Unrecognised AutoTrain response:", text.slice(0, 600));
      firstFailure = firstFailure || {
        status: 502,
        body: {
          error: "the classifier returned something unexpected",
          upstream_status: res.status,
          detail: upstreamMessage(text, data),
        },
      };
      continue;
    }

    const detail = upstreamMessage(text, data);
    console.error("AutoTrain returned", res.status, "for [" + attempt.label + "]:", text.slice(0, 600));

    if (res.status === 401 || res.status === 403) {
      return {
        status: 500,
        body: { error: "the classifier rejected our credentials", upstream_status: res.status, detail },
      };
    }
    if (res.status === 429) {
      return {
        status: 429,
        body: { error: "the classifier is busy — try again in a moment", upstream_status: res.status, detail },
      };
    }

    firstFailure = firstFailure || {
      status: 502,
      body: { error: "the classifier could not score that", upstream_status: res.status, detail },
    };

    /* Anything other than a complaint about the body means a different shape
       will not help. */
    if (!SHAPE_ERRORS.has(res.status)) break;
  }

  /* Every shape was refused. The first refusal is the honest one to report —
     the later ones only differ in where the model id sat. */
  preferredShape = null;
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
