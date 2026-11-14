import { defineConfig, type Plugin } from "vite";
import worker from "./worker/index";
/** Fast UI development executes the real Worker with no bindings. Full-stack: npm run dev:worker. */
const unconfiguredAPI: Plugin = {
  name: "echo-api-without-bindings",
  configureServer(server) {
    if (process.env.ECHO_DEV_API) return;
    server.middlewares.use("/api", async (req, res) => {
      try {
        const url = `http://${req.headers.host}/api${req.url || ""}`;
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers))
          if (v) headers.set(k, Array.isArray(v) ? v.join(",") : v);
        const response = await worker.fetch(
          new Request(url, { method: req.method, headers }),
          {},
        );
        res.statusCode = response.status;
        response.headers.forEach((v, k) => res.setHeader(k, v));
        res.end(await response.text());
      } catch {
        res.statusCode = 503;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({ code: "DEV_API", message: "讨论服务尚未启动。" }),
        );
      }
    });
  },
};
export default defineConfig({
  plugins: [unconfiguredAPI],
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: process.env.ECHO_DEV_API
      ? { "/api": { target: process.env.ECHO_DEV_API, changeOrigin: false } }
      : undefined,
  },
  build: {
    manifest: true,
    sourcemap: false,
    target: "es2022",
    // /admin is its own page and bundle; the public site never loads it.
    rollupOptions: { input: { main: "index.html", admin: "admin/index.html" } },
  },
});
