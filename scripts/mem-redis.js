// An in-memory stand-in for Upstash's REST pipeline endpoint, with just the
// commands Homey Home (and HomeyDeck's login) use. For `npm run dev` and the
// tests only; nothing is saved when it stops.
import http from "node:http";

export function memoryRedis() {
  const data = new Map(); // key → {v, exp}
  const live = (k) => {
    const e = data.get(k);
    if (e && e.exp && e.exp <= Date.now()) data.delete(k);
    return data.get(k);
  };
  const get = (k) => live(k)?.v;
  const put = (k, v, exp = live(k)?.exp) => data.set(k, { v, exp });
  const hashOf = (k) => get(k) ?? new Map();
  const setOf = (k) => get(k) ?? new Set();
  const listOf = (k) => get(k) ?? [];

  const commands = {
    GET: ([k]) => get(k) ?? null,
    GETDEL([k]) {
      const v = get(k) ?? null;
      data.delete(k);
      return v;
    },
    APPEND([k, v]) {
      const next = (get(k) ?? "") + v;
      put(k, next);
      return next.length;
    },
    SCARD: ([k]) => setOf(k).size,
    MGET: (ks) => ks.map((k) => (typeof get(k) === "string" ? get(k) : null)),
    SET([k, v, ...opts]) {
      let exp = null;
      const up = opts.map((o) => o.toUpperCase());
      const exists = live(k) !== undefined;
      if (up.includes("NX") && exists) return null;
      if (up.includes("XX") && !exists) return null;
      const ex = up.indexOf("EX");
      if (ex >= 0) exp = Date.now() + Number(opts[ex + 1]) * 1000;
      const old = get(k) ?? null;
      put(k, v, exp);
      return up.includes("GET") ? old : "OK";
    },
    GETEX([k, , s]) {
      const e = live(k);
      if (!e) return null;
      e.exp = Date.now() + Number(s) * 1000;
      return e.v;
    },
    DEL: (ks) => ks.filter((k) => live(k) !== undefined && data.delete(k)).length,
    EXISTS: (ks) => ks.filter((k) => live(k) !== undefined).length,
    EXPIRE([k, s]) {
      const e = live(k);
      if (!e) return 0;
      e.exp = Date.now() + Number(s) * 1000;
      return 1;
    },
    HSET([k, ...kv]) {
      const h = hashOf(k);
      let added = 0;
      for (let i = 0; i < kv.length; i += 2) {
        if (!h.has(kv[i])) added++;
        h.set(kv[i], kv[i + 1]);
      }
      put(k, h);
      return added;
    },
    HGET: ([k, f]) => hashOf(k).get(f) ?? null,
    HMGET: ([k, ...fs]) => fs.map((f) => hashOf(k).get(f) ?? null),
    HGETALL: ([k]) => [...hashOf(k)].flat(),
    HLEN: ([k]) => hashOf(k).size,
    HDEL([k, ...fs]) {
      const h = hashOf(k);
      const n = fs.filter((f) => h.delete(f)).length;
      if (!h.size) data.delete(k);
      return n;
    },
    SADD([k, ...ms]) {
      const s = setOf(k);
      const n = ms.filter((m) => !s.has(m) && s.add(m)).length;
      put(k, s);
      return n;
    },
    SREM: ([k, ...ms]) => ms.filter((m) => setOf(k).delete(m)).length,
    SMEMBERS: ([k]) => [...setOf(k)],
    LPUSH([k, ...vs]) {
      const l = listOf(k);
      for (const v of vs) l.unshift(v);
      put(k, l);
      return l.length;
    },
    LTRIM([k, a, b]) {
      const l = listOf(k);
      put(k, l.slice(Number(a), Number(b) < 0 ? l.length + Number(b) + 1 : Number(b) + 1));
      return "OK";
    },
    LRANGE([k, a, b]) {
      const l = listOf(k);
      return l.slice(Number(a), Number(b) < 0 ? l.length + Number(b) + 1 : Number(b) + 1);
    },
  };

  const run = (cmd) => {
    const [name, ...args] = cmd;
    const fn = commands[String(name).toUpperCase()];
    // EVAL (HomeyDeck's invite signup) needs a real Redis: see scripts/redis-rest.js.
    if (!fn) return { error: `ERR '${name}' isn't supported by the in-memory dev database; set REDIS_URL to use a real Redis` };
    return { result: fn(args.map(String)) };
  };
  return { run, data };
}

/** Serves memoryRedis() over HTTP like Upstash's /pipeline. */
export async function startMemoryRedis({ token = "dev-token" } = {}) {
  const db = memoryRedis();
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.headers.authorization !== `Bearer ${token}`) return res.writeHead(401).end();
      if (req.url !== "/pipeline") return res.writeHead(404).end();
      res.end(JSON.stringify(JSON.parse(body).map(db.run)));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, token, db, close: () => server.close() };
}
