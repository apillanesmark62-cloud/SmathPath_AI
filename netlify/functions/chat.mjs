/* ==========================================================
   SmartPath — server-side AI endpoint

   The browser posts { messages, system } here; this function adds the
   API key and talks to Anthropic. The key lives only in the server
   environment (ANTHROPIC_API_KEY) and is never sent to the browser.

   Served at /api/chat via the redirect in netlify.toml, and by the dev
   middleware in vite.config.js when running `npm run dev`.
   ========================================================== */

import Anthropic from "@anthropic-ai/sdk";

/* The model is pinned here, not chosen by the client. */
const MODEL = "claude-opus-5";
const MAX_TOKENS = 4000;
const EFFORT = "low"; // low | medium | high | xhigh | max — raise for deeper answers

/* Input limits. SmartPath's own prompts sit well inside these; they exist so a
   stray or hostile caller cannot run up a bill on one request. */
const MAX_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 8000;
const MAX_TOTAL_CHARS = 40000;
const MAX_SYSTEM_CHARS = 8000;

/* Best-effort rate limit. Serverless instances are not shared, so this slows
   down a casual flood but is not a hard guarantee — see README. */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
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

/* Drop expired buckets now and then so a long-lived instance does not grow. */
function sweep() {
  if (hits.size < 500) return;
  const now = Date.now();
  for (const [ip, seen] of hits) if (now > seen.resetAt) hits.delete(ip);
}

let client = null;
function anthropic() {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("missing-key");
    client = new Anthropic({ apiKey });
  }
  return client;
}

function validate(body) {
  if (!body || typeof body !== "object") return "Request body must be JSON.";

  const { messages, system } = body;
  if (!Array.isArray(messages) || messages.length === 0) return "messages must be a non-empty array.";
  if (messages.length > MAX_MESSAGES) return "Too many messages in one request.";
  if (system !== undefined && typeof system !== "string") return "system must be a string.";
  if (typeof system === "string" && system.length > MAX_SYSTEM_CHARS) return "system prompt is too long.";

  let total = 0;
  for (const m of messages) {
    if (!m || typeof m !== "object") return "Each message must be an object.";
    if (m.role !== "user" && m.role !== "assistant") return "Each message role must be user or assistant.";
    if (typeof m.content !== "string" || !m.content.trim()) return "Each message needs non-empty text content.";
    if (m.content.length > MAX_MESSAGE_CHARS) return "One of the messages is too long.";
    total += m.content.length;
  }
  if (total > MAX_TOTAL_CHARS) return "The conversation is too long. Clear it and try again.";

  return null;
}

/* Shared by the Netlify handler and the Vite dev middleware.
   Returns { status, body } — body is always a plain JSON-able object. */
export async function handleChat(body, ip = "local") {
  sweep();
  if (rateLimited(ip)) {
    return { status: 429, body: { error: "too many requests — wait a minute and try again" } };
  }

  const problem = validate(body);
  if (problem) return { status: 400, body: { error: problem } };

  const { messages, system } = body;

  let message;
  try {
    message = await anthropic().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      output_config: { effort: EFFORT },
      ...(system ? { system } : {}),
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
  } catch (e) {
    if (e && e.message === "missing-key") {
      console.error("ANTHROPIC_API_KEY is not set in the environment.");
      return { status: 500, body: { error: "the server is not configured yet" } };
    }
    /* Log the detail server-side; send the client only a status. */
    console.error("Anthropic request failed:", e && e.message ? e.message : e);
    const status = e && typeof e.status === "number" && e.status >= 400 && e.status < 500 ? e.status : 502;
    return { status, body: { error: "the AI service is unavailable" } };
  }

  if (message.stop_reason === "refusal") {
    return { status: 200, body: { content: [{ type: "text", text: "" }], stop_reason: "refusal" } };
  }

  return {
    status: 200,
    body: {
      content: (message.content || []).filter((b) => b.type === "text").map((b) => ({ type: "text", text: b.text })),
      stop_reason: message.stop_reason,
    },
  };
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

  const { status, body: payload } = await handleChat(body, ip);
  return Response.json(payload, { status });
}
