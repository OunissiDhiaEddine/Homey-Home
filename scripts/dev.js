// Local server for working on Homey Home without Vercel:
//   npm run dev            (FAKE_RM4=1 npm run dev also starts a pretend RM4 Pro)
// It serves public/ (Homey Home at /, HomeyDeck at /deck/) and the same API routes. Unless KV_REST_API_URL /
// KV_REST_API_TOKEN point at a real database, it uses a throwaway in-memory
// one with a ready-made admin account: dev / devpassword (DEV_PASSWORD).
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startMemoryRedis } from "./mem-redis.js";
import { hashPassword } from "../lib/secrets.js";
import { startFakeRm4 } from "./fake-rm4.js";

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pub = path.join(rootDir, "public");

if (!process.env.KV_REST_API_URL) {
  const db = await startMemoryRedis();
  process.env.KV_REST_API_URL = db.url;
  process.env.KV_REST_API_TOKEN = db.token;
  const uid = "devuser0000000000000AA";
  const password = process.env.DEV_PASSWORD || "devpassword";
  db.db.run(["SET", "uname:dev", uid]);
  db.db.run(["HSET", `u:${uid}`, "name", "dev", "role", "admin", "pw", await hashPassword(password), "created", Date.now()]);
  console.log(`In-memory database with an admin account: dev / ${password}`);
}
// HomeyDeck seals PCs' wake details with DATA_KEY; a throwaway one is fine locally.
process.env.DATA_KEY ||= "dev-data-key-".padEnd(44, "x");

if (process.env.FAKE_RM4) {
  const fake = await startFakeRm4({ port: Number(process.env.FAKE_RM4_PORT || 8780) });
  console.log(`Fake RM4 pro on udp://127.0.0.1:${fake.port} (use 127.0.0.1 and ${fake.port} in Settings)`);
}

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      // The same file-based routing as Vercel: /api/climate → api/climate.js.
      const file = path.join(rootDir, path.normalize(url.pathname) + ".js");
      let mod;
      try {
        mod = await import(pathToFileURL(file));
      } catch {
        return res.writeHead(404).end("not found");
      }
      const handler = mod[req.method];
      if (!handler) return res.writeHead(405).end();
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const request = new Request(url, { method: req.method, headers: req.headers, body: req.method === "GET" ? undefined : Buffer.concat(chunks) });
      const response = await handler(request);
      // Browsers drop Secure cookies on plain http://localhost in some cases; strip it for dev.
      const headers = Object.fromEntries(response.headers);
      if (headers["set-cookie"]) headers["set-cookie"] = headers["set-cookie"].replace("; Secure", "");
      res.writeHead(response.status, headers);
      return res.end(Buffer.from(await response.arrayBuffer()));
    }
    if (url.pathname === "/deck") return res.writeHead(308, { Location: "/deck/" }).end();
    const file = path.join(pub, path.normalize(url.pathname.endsWith("/") ? `${url.pathname}index.html` : url.pathname));
    if (!file.startsWith(pub)) return res.writeHead(404).end();
    try {
      const data = await fs.readFile(file);
      res.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream" }).end(data);
    } catch {
      res.writeHead(404).end("not found");
    }
  })
  .listen(Number(process.env.PORT || 3000), "127.0.0.1", () => console.log(`Homey Home dev server on http://localhost:${process.env.PORT || 3000}`));
