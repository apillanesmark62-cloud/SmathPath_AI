import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

/* Serves /api/chat during `npm run dev` using the same handler Netlify runs in
   production, so local development matches the deployed behaviour. The API key
   is read from the shell environment or a local .env file and stays in this
   Node process — Vite only ever bundles VITE_-prefixed variables into the
   client, and there are none, so the key cannot leak into the browser. */
function apiDevServer() {
  let handleChat;

  return {
    name: "smartpath-api-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/api/chat", async (req, res) => {
        const send = (status, payload) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(payload));
        };

        if (req.method !== "POST") {
          res.setHeader("Allow", "POST");
          send(405, { error: "use POST" });
          return;
        }

        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);

        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch (e) {
          send(400, { error: "Request body must be JSON." });
          return;
        }

        try {
          if (!handleChat) ({ handleChat } = await import("./netlify/functions/chat.mjs"));
          const result = await handleChat(body, req.socket.remoteAddress || "local");
          send(result.status, result.body);
        } catch (e) {
          server.config.logger.error("[smartpath] /api/chat failed: " + (e && e.message ? e.message : e));
          send(500, { error: "the dev API handler crashed — see the terminal" });
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  /* Make ANTHROPIC_API_KEY from a local .env visible to the dev handler.
     The third argument is "" so unprefixed variables are read too; nothing
     here is passed to the client bundle. */
  const env = loadEnv(mode, process.cwd(), "");
  if (!process.env.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
  }

  return {
    plugins: [react(), apiDevServer()],
    build: {
      outDir: "dist",
      sourcemap: false,
    },
  };
});
