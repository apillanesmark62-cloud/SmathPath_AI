/* ==========================================================
   SmartPath — strand classifier endpoint

   Calls the AutoTrain Decision Tree model. The browser posts the eight
   questionnaire answers here; this function forwards them to AutoTrain and
   normalises the answer, so no credential ever reaches the browser and the
   request is not subject to the model host's CORS policy.

   Request and response shapes below match the working sample from the
   AutoTrain Testing Console verbatim — see README.

   Environment variables:
     AUTOTRAIN_URL      optional — overrides DEFAULT_URL below. Set it when the
                        job id changes, i.e. when the model is retrained and
                        AutoTrain issues a new one.
     The endpoint answers "401 Dashboard authentication is required" without a
     bearer token. The Testing Console sends a Firebase ID token for the
     project that hosts AutoTrain, and those last exactly one hour, so there
     are two ways to supply one — see the credentials section below.

     AUTOTRAIN_API_KEY            the credential from the Testing Console's
                                  Authorization header, sent as a bearer
                                  token. Simple, and it stops working an hour
                                  after the token was minted.
     AUTOTRAIN_AUTH               alias for AUTOTRAIN_API_KEY.
     AUTOTRAIN_REFRESH_TOKEN      \ together these mint a fresh ID token on
     AUTOTRAIN_FIREBASE_API_KEY   / demand and keep working indefinitely.
   ========================================================== */

/* The prediction endpoint, taken from the Testing Console's own network
   traffic rather than inferred.

   Prediction is per-job: the path names the training job, and its id is the
   same value AutoTrain returns as model_id. Retraining issues a new job, so
   if predictions start coming back 404, this id is the thing that went stale
   — override it with AUTOTRAIN_URL rather than editing this line.

   ?access=dashboard is part of the URL the console uses and is carried
   through verbatim. It is a mode flag, not a credential, but it is also the
   part most likely to tie the request to a signed-in dashboard session — if
   this endpoint ever answers 401 or 403 from the deployed function while the
   console still works, that is the first thing to suspect.

   None of this reaches the browser: the client posts to /api/classify on its
   own origin and this function makes the outbound call. */
export const DEFAULT_URL =
  "https://api.autotrain.app/api/autotrain/jobs/cdf2edb7-cddd-4abb-9124-93a90d53d3f2/predict?access=dashboard";

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

/* ==========================================================
   Credentials

   The prediction endpoint requires the same bearer token the AutoTrain
   dashboard sends: a Firebase ID token, issued by Google's secure token
   service for the project that hosts AutoTrain.

   Those tokens live for one hour. A token pasted into an environment
   variable therefore fixes the site until it expires and then breaks it for
   everyone, which is why the refresh path exists: a Firebase refresh token
   does not expire unless it is revoked, and exchanging one for a fresh ID
   token is a documented, unauthenticated-by-design call that needs only the
   project's public web API key.

   Whichever route supplies the token, it is read here, in the serverless
   function, and never sent to the browser.
   ========================================================== */

/* Google's secure token service. Overridable by AUTOTRAIN_TOKEN_ENDPOINT so
   the refresh path can be exercised against a stand-in without reaching out
   to Google, and so a move on Google's side is a config change. */
const REFRESH_ENDPOINT = "https://securetoken.googleapis.com/v1/token";

function tokenEndpoint() {
  return process.env.AUTOTRAIN_TOKEN_ENDPOINT || REFRESH_ENDPOINT;
}

/* Renew this long before expiry so a request in flight cannot age out. */
const RENEW_MARGIN_MS = 5 * 60_000;

/* Held for the life of the instance: one exchange serves many predictions. */
let cachedToken = null;

/* A JWT's expiry, read from its payload without verifying the signature —
   this is our own token and we only want to know when to replace it. */
function tokenExpiry(jwt) {
  try {
    const part = String(jwt).split(".")[1];
    if (!part) return null;
    const claims = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return typeof claims.exp === "number" ? claims.exp * 1000 : null;
  } catch (e) {
    return null;
  }
}

/* The configured credential and which variable held it. Pasting the whole
   header value, "Bearer eyJ...", is the obvious mistake to make and costs
   nothing to absorb. */
function staticToken() {
  for (const name of ["AUTOTRAIN_API_KEY", "AUTOTRAIN_AUTH"]) {
    const raw = process.env[name];
    if (typeof raw === "string" && raw.trim()) {
      return { token: raw.trim().replace(/^Bearer\s+/i, ""), source: name };
    }
  }
  return { token: "", source: null };
}

/* The Firebase web API key, under either spelling. API_KEY and APIKEY are
   both natural things to type, and a mismatch here costs a redeploy to find
   out about, so accept the pair rather than adjudicate between them. */
const FIREBASE_KEY_NAMES = ["AUTOTRAIN_FIREBASE_API_KEY", "AUTOTRAIN_FIREBASE_APIKEY"];

function firebaseApiKey() {
  for (const name of FIREBASE_KEY_NAMES) {
    const v = process.env[name];
    if (typeof v === "string" && v.trim()) return { key: v.trim(), source: name };
  }
  return { key: "", source: null };
}

async function refreshedToken() {
  const refresh = process.env.AUTOTRAIN_REFRESH_TOKEN;
  const { key: apiKey } = firebaseApiKey();

  /* Half-configured is the likeliest way to set this up wrong, and staying
     quiet about it turns into a 401 that blames something else. Name the
     missing half instead. */
  if (refresh && !apiKey) {
    throw new Error(
      "AUTOTRAIN_REFRESH_TOKEN is set but no Firebase API key is — add " +
        FIREBASE_KEY_NAMES.join(" or ") + " (either spelling works)"
    );
  }
  if (apiKey && !refresh) {
    throw new Error("a Firebase API key is set but AUTOTRAIN_REFRESH_TOKEN is not — both are needed");
  }
  if (!refresh) return null;

  if (cachedToken && cachedToken.expiresAt - Date.now() > RENEW_MARGIN_MS) {
    return cachedToken.token;
  }

  const res = await fetch(tokenEndpoint() + "?key=" + encodeURIComponent(apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }).toString(),
  });
  const text = await res.text();

  let data = null;
  try {
    data = JSON.parse(text);
  } catch (e) {
    /* reported below */
  }

  if (!res.ok) {
    const why = (data && data.error && (data.error.message || data.error)) || text.slice(0, 200);
    throw new Error("refreshing the AutoTrain token failed (" + res.status + "): " + why);
  }

  const token = data && (data.id_token || data.access_token);
  if (!token) throw new Error("the token service returned no id_token");

  const expiresAt =
    tokenExpiry(token) || Date.now() + Number((data && data.expires_in) || 3600) * 1000;
  cachedToken = { token, expiresAt };
  console.log("[classify] minted a fresh ID token, good until " + new Date(expiresAt).toISOString());
  return token;
}

/* The token to send, and where it came from. Refreshing wins when it is
   configured, because a static token is the one that goes stale. */
async function authToken() {
  let refreshError = null;
  try {
    const fresh = await refreshedToken();
    if (fresh) return { token: fresh, source: "AUTOTRAIN_REFRESH_TOKEN" };
  } catch (e) {
    refreshError = e && e.message ? e.message : String(e);
    console.error("[classify] " + refreshError);
  }

  const fixed = staticToken();
  if (fixed.token) return { token: fixed.token, source: fixed.source, refreshError };
  return { token: null, source: null, refreshError };
}

/* Describe a token for the diagnostics block without ever showing it. Its
   expiry is the useful part: an expired token is the likeliest cause of a
   401, and saying so beats making someone guess. */
function describeToken(token, source) {
  if (!token) return { set: false };
  const expiresAt = tokenExpiry(token);
  const out = { set: true, source, length: token.length };
  if (expiresAt) {
    out.expires_at = new Date(expiresAt).toISOString();
    const left = expiresAt - Date.now();
    out.expired = left <= 0;
    out.minutes_left = Math.round(left / 60000);
  }
  return out;
}

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
function readStatus(status, contentType, auth) {
  const configured = process.env.AUTOTRAIN_URL ? "AUTOTRAIN_URL" : "the endpoint in classify.mjs";

  if (status === 404) {
    return (
      "A 404 means the server answered but has no route at that path. The URL names a " +
      "training job, and retraining issues a new job id, so a stale id is the likeliest " +
      "cause. Run one prediction in the AutoTrain Testing Console with the browser's " +
      "Network tab recording, copy the Request URL, and set AUTOTRAIN_URL to it."
    );
  }
  if (status === 405) {
    return "A 405 means the path exists but does not take POST — check the method the Testing Console uses.";
  }
  if (status === 422) {
    return "A 422 means the path is right and the body is not — the field names or their types do not match what the model expects.";
  }
  if (status === 401 || status === 403) {
    const fixed = staticToken();
    const expiresAt = fixed.token ? tokenExpiry(fixed.token) : null;

    /* A configured refresh that failed outranks everything else: it explains
       the 401 directly, and any other advice would send you to fix something
       that is not broken. */
    if (auth && auth.refreshError) {
      return "The token could not be renewed, so the request went out with whatever credential was left: " +
        auth.refreshError + ".";
    }
    if (auth && auth.source === "AUTOTRAIN_REFRESH_TOKEN") {
      return (
        "A freshly minted token was sent and still refused. That points at the refresh token " +
        "belonging to a different account or Firebase project than the model — check that " +
        "AUTOTRAIN_FIREBASE_API_KEY is the same project's web API key, and that you were " +
        "signed in as the model's owner when you copied the refresh token."
      );
    }

    if (!fixed.token && !process.env.AUTOTRAIN_REFRESH_TOKEN) {
      return (
        "The endpoint needs the same bearer token the AutoTrain dashboard sends, and no " +
        "credential reached this function. In Netlify, under Site configuration -> " +
        "Environment variables, add AUTOTRAIN_API_KEY with the value of the Authorization " +
        "header from the Testing Console's successful request, then redeploy — the value is " +
        "bound at deploy time, so saving it alone changes nothing. If you have already done " +
        "that, compare the name against the variables listed below, and check the value is " +
        "scoped to Functions and to the deploy context you are testing."
      );
    }
    if (expiresAt && expiresAt <= Date.now()) {
      const hours = Math.round((Date.now() - expiresAt) / 3600000);
      const ago = hours < 1 ? "less than an hour" : hours === 1 ? "an hour" : hours + " hours";
      return (
        fixed.source + " holds a token that expired " + ago + " ago, and no refresh is " +
        "configured. Firebase ID tokens last one hour, so replacing it buys another hour. To " +
        "stop doing that, add AUTOTRAIN_REFRESH_TOKEN and AUTOTRAIN_FIREBASE_API_KEY — spelled " +
        "exactly that way — and the function will renew the token itself. Delete " +
        fixed.source + " once they are in place."
      );
    }
    return (
      "The token was sent and refused. If it was minted for a different Firebase project " +
      "than the one hosting AutoTrain it will not be accepted — check the request headers " +
      "in the Testing Console's Network tab against the ones listed below. Do not move the " +
      "call into the browser to work around it; that would publish the token to every visitor."
    );
  }
  return null;
}

/* Only a 404 earns the second URL: it is the one status meaning "no route
   here", which the trailing-slash variant can answer. Every other refusal is
   about the request or the server, and repeating it would only add noise. */
const RETRYABLE = new Set([404]);

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
function envReport(auth) {
  const url = process.env.AUTOTRAIN_URL;
  const report = {
    AUTOTRAIN_URL: url ? { set: true, value: url } : { set: false, using: DEFAULT_URL },
    AUTOTRAIN_API_KEY: staticToken().source === "AUTOTRAIN_API_KEY" ? { set: true } : { set: false },
    bearer_token: describeToken(auth && auth.token, auth && auth.source),
    AUTOTRAIN_REFRESH_TOKEN: process.env.AUTOTRAIN_REFRESH_TOKEN ? { set: true } : { set: false },
    AUTOTRAIN_FIREBASE_API_KEY: (() => {
      const found = firebaseApiKey();
      return found.key ? { set: true, as: found.source } : { set: false };
    })(),
    node: typeof process !== "undefined" && process.version ? process.version : "unknown",
  };

  /* Which deploy this is. Netlify scopes environment variables by context, so
     a variable added to production only is genuinely absent on a deploy
     preview or a branch deploy, and that is indistinguishable from never
     having added it unless the context is named. Not every one of these
     reaches function runtime, so report whichever do. */
  const deploy = {};
  for (const key of ["CONTEXT", "BRANCH", "SITE_NAME", "DEPLOY_URL", "DEPLOY_ID"]) {
    if (process.env[key]) deploy[key] = process.env[key];
  }
  if (Object.keys(deploy).length) report.deploy = deploy;

  /* The NAMES of the variables this function can actually see, filtered to the
     ones that concern it. Names are not secrets and no value is read here.

     This is the difference between "you have not added it" and "you added it
     as AUTOTRAIN_APIKEY", or with a trailing space, or in lower case — three
     mistakes that all look identical from a NOT SET line, and none of which
     any amount of staring at the Netlify UI reliably catches. */
  report.visible_variables = Object.keys(process.env)
    .filter((k) => /autotrain|firebase|anthropic/i.test(k))
    .sort();

  if (auth && auth.refreshError) report.refresh_error = auth.refreshError;
  return report;
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

  let auth = await authToken();
  if (auth.token) headers.Authorization = "Bearer " + auth.token;

  /* At most one re-authentication per request, shared across the URL attempts
     so a stale token cannot cost two extra round trips. */
  let reauthenticated = false;

  /* What goes in the trace: identical to what is sent, minus the credential.
     The token is never echoed — only whether there is one, and when it dies. */
  const shownHeaders = { ...headers };
  if (shownHeaders.Authorization) shownHeaders.Authorization = "Bearer <redacted>";


  const attempts = attemptsFor(body.answers, baseUrl);

  /* Every attempt is recorded in full — request as sent, status, response
     headers, and the response body as text exactly as it arrived, before any
     JSON parsing. Failures return this to the caller rather than summarising
     it, so the live error is readable without digging through logs. */
  const trace = [];
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

    const send = () => fetch(url, { method: "POST", headers, body: payload });

    let res;
    try {
      res = await send();

      /* A 401 on a token we believed was live means our idea of its expiry was
         wrong — it was revoked, rotated, or the clocks disagree. The cached
         token is the thing at fault, so discard it, mint another and try once
         more. Only once, and only when refreshing is what issued the token:
         retrying a static token would just repeat the same 401. */
      if (
        res.status === 401 &&
        !reauthenticated &&
        auth.source === "AUTOTRAIN_REFRESH_TOKEN"
      ) {
        reauthenticated = true;
        cachedToken = null;
        console.log("[classify] 401 on a token we thought was live — re-authenticating");

        const retry = await authToken();
        if (retry.token) {
          headers.Authorization = "Bearer " + retry.token;
          auth = retry;
          step.reauthenticated = true;
          res = await send();
        } else if (retry.refreshError) {
          auth = retry;
          step.reauthenticated = false;
          step.reauth_error = retry.refreshError;
        }
      }
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
          env: envReport(auth),
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

    const hint = readStatus(res.status, contentType, auth);

    if (res.status === 401 || res.status === 403) {
      return { status: 502, body: { error: headline, upstream_status: res.status, detail, hint, trace, env: envReport(auth) } };
    }
    if (res.status === 429) {
      return { status: 429, body: { error: headline, upstream_status: res.status, detail, hint, trace, env: envReport(auth) } };
    }

    firstFailure = firstFailure || {
      status: 502,
      body: { error: headline, upstream_status: res.status, detail, hint },
    };

    /* Anything other than a complaint about the body means a different shape
       will not help. */
    if (!RETRYABLE.has(res.status)) break;
  }

  /* Both URLs were refused. The first refusal is the honest one to report —
     the second only differs by a trailing slash. */
  firstFailure.body.trace = trace;
  firstFailure.body.env = envReport(auth);
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
