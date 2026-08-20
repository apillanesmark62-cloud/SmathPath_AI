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

/* AutoTrain takes one object per row under "data". */
function buildPayload(answers) {
  const row = {};
  for (const f of FEATURES) row[f] = answers[f];
  return { data: [row] };
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

  const url = process.env.AUTOTRAIN_URL || DEFAULT_URL;
  const headers = { "Content-Type": "application/json" };
  if (process.env.AUTOTRAIN_API_KEY) {
    headers.Authorization = "Bearer " + process.env.AUTOTRAIN_API_KEY;
  }

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(buildPayload(body.answers)),
    });
  } catch (e) {
    console.error("AutoTrain request failed:", e && e.message ? e.message : e);
    return { status: 502, body: { error: "could not reach the classifier" } };
  }

  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (e) {
    /* fall through to the error below */
  }

  if (!res.ok) {
    console.error("AutoTrain returned", res.status, text.slice(0, 400));
    if (res.status === 401 || res.status === 403) {
      return { status: 500, body: { error: "the classifier rejected our credentials" } };
    }
    if (res.status === 429) {
      return { status: 429, body: { error: "the classifier is busy — try again in a moment" } };
    }
    return { status: 502, body: { error: "the classifier could not score that" } };
  }

  const result = normalise(data);
  if (!result) {
    console.error("Unrecognised AutoTrain response:", text.slice(0, 400));
    return { status: 502, body: { error: "the classifier returned something unexpected" } };
  }

  return { status: 200, body: result };
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
