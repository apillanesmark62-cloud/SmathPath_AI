import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

/* Serves the /api/* endpoints during `npm run dev` using the same handlers
   Netlify runs in production, so local development matches the deployed
   behaviour. Secrets are read from the shell environment or a local .env file
   and stay in this Node process — Vite only ever bundles VITE_-prefixed
   variables into the client, and there are none, so no key can leak into the
   browser. */
const API_ROUTES = [
  { path: "/api/chat", module: "netlify/functions/chat.mjs", handler: "handleChat" },
  { path: "/api/classify", module: "netlify/functions/classify.mjs", handler: "handleClassify" },
];

function apiDevServer() {
  const loaded = new Map();

  return {
    name: "smartpath-api-dev",
    apply: "serve",
    configureServer(server) {
      for (const route of API_ROUTES) {
        server.middlewares.use(route.path, async (req, res) => {
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
            if (!loaded.has(route.path)) {
              /* Resolve from the project root: Vite may bundle this config into
                 node_modules/.vite-temp, and a dynamic specifier would then be
                 resolved relative to that directory instead of the repo. */
              const url = pathToFileURL(resolve(process.cwd(), route.module)).href;
              const mod = await import(url);
              loaded.set(route.path, mod[route.handler]);
            }
            const result = await loaded.get(route.path)(body, req.socket.remoteAddress || "local");
            send(result.status, result.body);
          } catch (e) {
            server.config.logger.error(
              "[smartpath] " + route.path + " failed: " + (e && e.message ? e.message : e)
            );
            send(500, { error: "the dev API handler crashed — see the terminal" });
          }
        });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  /* Make the server-side secrets from a local .env visible to the dev
     handlers. The third argument is "" so unprefixed variables are read too;
     nothing here is passed to the client bundle. */
  const env = loadEnv(mode, process.cwd(), "");
  for (const key of ["ANTHROPIC_API_KEY", "AUTOTRAIN_URL", "AUTOTRAIN_AUTH", "AUTOTRAIN_API_KEY",
                     "AUTOTRAIN_REFRESH_TOKEN", "AUTOTRAIN_FIREBASE_API_KEY",
                     "AUTOTRAIN_TOKEN_ENDPOINT"]) {
    if (!process.env[key] && env[key]) process.env[key] = env[key];
  }

  return {
    plugins: [react(), apiDevServer()],
    build: {
      outDir: "dist",
      sourcemap: false,
    },
  };
});
