/* ==========================================================
   SmartPath — strand classifier endpoint

   Calls the AutoTrain-trained model over the Hugging Face REST API.
   The browser posts the eight questionnaire answers here; this function
   adds the token and talks to the model, so the token stays server-side.

   Environment variables:
     HF_CLASSIFIER_URL     required — the model's inference URL, either
                           https://api-inference.huggingface.co/models/<user>/<model>
                           or a dedicated endpoint
                           https://<id>.<region>.aws.endpoints.huggingface.cloud
     HF_API_TOKEN          required — a Hugging Face access token (hf_...)
     HF_CLASSIFIER_FORMAT  optional — "tabular" (default) or "text".
                           AutoTrain tabular models take a column/row payload;
                           text-classification models take a sentence. Set this
                           to match how the model was trained.

   Served at /api/classify via the redirect in netlify.toml, and by the dev
   middleware in vite.config.js when running `npm run dev`.
   ========================================================== */

/* The eight features, in the order the model expects its columns. */
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

/* The seven ratings are 1-5; preferred_activity is a category. */
const RATINGS = FEATURES.slice(0, 7);
const RATING_MIN = 1;
const RATING_MAX = 5;

export const ACTIVITIES = [
  "Solving math problems",
  "Doing science experiments",
  "Running a small business",
  "Writing or speaking",
  "Working with computers",
  "Drawing or designing",
  "Building or repairing things",
];

/* Best-effort rate limit, same caveat as the chat endpoint: it is per
   serverless instance, not global. */
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

/* AutoTrain tabular models take columns + rows; text-classification models
   take a sentence. Which one applies depends on how the model was trained,
   so the shape is selected by HF_CLASSIFIER_FORMAT. */
function buildPayload(answers, format) {
  if (format === "text") {
    const sentence = FEATURES.map((f) => f + ": " + answers[f]).join(", ");
    return { inputs: sentence };
  }
  return {
    inputs: {
      data: [FEATURES.map((f) => answers[f])],
      columns: FEATURES,
    },
  };
}

/* Hugging Face returns several shapes depending on the task and endpoint.
   Normalise them all to a ranked [{ label, score }] list. */
function normalise(raw) {
  let list = raw;

  /* Text classification nests one array per input. */
  if (Array.isArray(list) && Array.isArray(list[0])) list = list[0];

  /* Tabular endpoints wrap the answer in an object. */
  if (list && !Array.isArray(list) && typeof list === "object") {
    if (Array.isArray(list.predictions)) list = list.predictions;
    else if (Array.isArray(list.labels)) list = list.labels;
    else if (Array.isArray(list.data)) list = list.data;
  }

  if (!Array.isArray(list) || !list.length) return null;

  /* Tabular models often return bare labels: ["STEM"] or [2]. */
  if (typeof list[0] !== "object") {
    return [{ label: String(list[0]), score: null }];
  }

  const ranked = list
    .filter((r) => r && (r.label !== undefined || r.class !== undefined))
    .map((r) => ({
      label: String(r.label !== undefined ? r.label : r.class),
      score: typeof r.score === "number" ? r.score : typeof r.probability === "number" ? r.probability : null,
    }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  return ranked.length ? ranked : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function handleClassify(body, ip = "local") {
  sweep();
  if (rateLimited(ip)) {
    return { status: 429, body: { error: "too many requests — wait a minute and try again" } };
  }

  const problem = validate(body);
  if (problem) return { status: 400, body: { error: problem } };

  const url = process.env.HF_CLASSIFIER_URL;
  const token = process.env.HF_API_TOKEN;
  if (!url || !token) {
    console.error("HF_CLASSIFIER_URL and/or HF_API_TOKEN are not set in the environment.");
    return { status: 500, body: { error: "the classifier is not configured yet" } };
  }

  const format = process.env.HF_CLASSIFIER_FORMAT === "text" ? "text" : "tabular";
  const payload = buildPayload(body.answers, format);

  /* A serverless Hugging Face model that has gone cold answers 503 with an
     estimated load time. Wait once and try again rather than failing. */
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      console.error("Classifier request failed:", e && e.message ? e.message : e);
      return { status: 502, body: { error: "could not reach the classifier" } };
    }

    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (e) {
      /* leave data null and fall through to the error below */
    }

    if (res.status === 503 && attempt === 0) {
      const wait = data && typeof data.estimated_time === "number" ? Math.min(data.estimated_time, 20) : 5;
      await sleep(wait * 1000);
      continue;
    }

    if (!res.ok) {
      console.error("Classifier returned", res.status, text.slice(0, 400));
      if (res.status === 503) {
        return { status: 503, body: { error: "the model is still warming up — try again in a moment" } };
      }
      if (res.status === 401 || res.status === 403) {
        return { status: 500, body: { error: "the classifier rejected our credentials" } };
      }
      return { status: 502, body: { error: "the classifier could not score that" } };
    }

    const ranked = normalise(data);
    if (!ranked) {
      console.error("Unrecognised classifier response:", text.slice(0, 400));
      return { status: 502, body: { error: "the classifier returned something unexpected" } };
    }

    return {
      status: 200,
      body: { strand: ranked[0].label, confidence: ranked[0].score, ranked: ranked.slice(0, 6) },
    };
  }

  return { status: 503, body: { error: "the model is still warming up — try again in a moment" } };
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
