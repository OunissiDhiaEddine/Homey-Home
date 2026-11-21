/**
 * The RM4 Pro: settings, sessions, climate, learning and sending.
 *
 *   hh:device          hash: host, port, mac, devtype, name, locked, checked
 *   hh:bl              the device session (id + key) from the last auth, 20 minutes
 *   hh:climate:now     the last reading, 25 seconds, so several open apps share one
 *   hh:climate:tick    set for 5 minutes after a reading is logged
 *   hh:climate:log     list of "seconds|temperature|humidity", newest first, 2 days
 *   hh:lights          hash: light remote id → "on" | "off", what its last button meant
 *
 * Authenticating costs a round trip to your house, so the session key is
 * kept in Redis and reused; if the device has rebooted and forgotten it, we
 * authenticate again and retry once.
 */

import { pipeline, command, hash } from "./redis.js";
import { HttpError, json, body, parse, str } from "./http.js";
import { requireUser, publicUser, refreshCookie } from "./auth.js";
import { Device, BroadlinkError, DEFAULT_PORT, modelName, parseCode, codeKind } from "./broadlink.js";
import { HOME_KEY, CODES_KEY, LIGHTS_KEY, loadHome, lightAfter } from "./home.js";

const DEVICE_KEY = "hh:device";
const SESSION_KEY = "hh:bl";
const SESSION_TTL_S = 1200;
const NOW_KEY = "hh:climate:now";
const TICK_KEY = "hh:climate:tick";
const LOG_KEY = "hh:climate:log";
const NOW_TTL_S = 25;
const LOG_EVERY_S = 290;
const LOG_KEEP = 576; // 2 days at 5 minutes

const HOST_RE = /^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$|^\d{1,3}(\.\d{1,3}){3}$/;

export const DEVICE_CMDS = [["HGETALL", DEVICE_KEY], ["GET", SESSION_KEY]];
export const CLIMATE_CMDS = [["GET", NOW_KEY], ["LRANGE", LOG_KEY, 0, 287]];

/** Where the RM4 is: saved in the app, or BROADLINK_HOST / BROADLINK_PORT. */
export function deviceConfig(env, flat) {
  const d = hash(flat) ?? {};
  return {
    host: d.host || String(env.BROADLINK_HOST ?? "").trim(),
    port: Number(d.port || env.BROADLINK_PORT) || DEFAULT_PORT,
    mac: d.mac || "",
    devtype: Number(d.devtype) || undefined,
    name: d.name || "",
    locked: d.locked === "1",
    checked: Number(d.checked) || 0,
  };
}

export function publicDevice(cfg) {
  return {
    configured: Boolean(cfg.host),
    host: cfg.host,
    port: cfg.port,
    mac: cfg.mac || null,
    model: cfg.devtype ? modelName(cfg.devtype) : null,
    name: cfg.name || null,
    locked: cfg.locked,
    checked: cfg.checked || null,
  };
}

/**
 * Runs fn(device) with an authenticated device, reusing the saved session
 * when it's for the same address, and re-authenticating once if it's stale.
 */
export async function withDevice(env, [flat, rawSession], fn, { timeoutMs = 3500 } = {}) {
  const cfg = deviceConfig(env, flat);
  if (!cfg.host) throw new HttpError(409, "add your RM4's address in Settings first", "no_device");
  const dev = new Device({ ...cfg, timeoutMs });
  const saved = parse(rawSession);
  const ip = await dev.address();
  const fresh = async () => {
    await dev.auth();
    await command(["SET", SESSION_KEY, JSON.stringify(dev.session()), "EX", SESSION_TTL_S], env);
  };

  if (saved?.key && saved.ip === ip) dev.restore(saved);
  else await fresh();
  try {
    return await fn(dev);
  } catch (err) {
    const stale = err instanceof BroadlinkError && (err.authProblem || err.timeout || err.code === -4008);
    if (!saved?.key || saved.ip !== ip || !stale) throw err;
    await fresh(); // a timeout here means the device really is unreachable
    return await fn(dev);
  }
}

// --- GET /api/home: what the app loads when it opens ------------------------

export async function homeGet(request, env) {
  const { uid, user, rest } = await requireUser(request, env, [["GET", HOME_KEY], ["HGETALL", DEVICE_KEY], ["HGETALL", LIGHTS_KEY]], { slide: true });
  const home = await loadHome(env, rest[0]);
  return json(
    { ok: true, user: publicUser(uid, user), home, lights: hash(rest[2]) ?? {}, device: publicDevice(deviceConfig(env, rest[1])) },
    200,
    { "Set-Cookie": refreshCookie(request) },
  );
}

// --- POST /api/device {action: save | test | forget} -------------------------

export async function devicePost(request, env) {
  const { rest } = await requireUser(request, env, DEVICE_CMDS);
  const data = await body(request);
  let [flat] = rest;

  if (data.action === "forget") {
    await pipeline([["DEL", DEVICE_KEY, SESSION_KEY, NOW_KEY]], env);
    return json({ ok: true, device: publicDevice(deviceConfig(env, null)) });
  }

  if (data.action === "save") {
    const host = str(data.host, 253).replace(/^[a-z]+:\/\//i, "").replace(/[/:].*$/, "");
    const port = data.port === undefined || data.port === "" ? DEFAULT_PORT : Number(data.port);
    if (!HOST_RE.test(host)) throw new HttpError(400, "the address should be a DDNS name like myhome.mywire.org, or an IP address");
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new HttpError(400, "the port must be a number from 1 to 65535");
    // A new address may be a new device: forget what we knew about the old one.
    await pipeline([["DEL", DEVICE_KEY, SESSION_KEY, NOW_KEY], ["HSET", DEVICE_KEY, "host", host, "port", port]], env);
    flat = ["host", host, "port", String(port)];
  } else if (data.action !== "test") {
    throw new HttpError(400, "unknown action");
  }

  // Test: hello (model, MAC, name, lock), then auth with what it told us.
  const cfg = deviceConfig(env, flat);
  if (!cfg.host) throw new HttpError(409, "add your RM4's address first", "no_device");
  const dev = new Device({ host: cfg.host, port: cfg.port, timeoutMs: 4000 });
  let info;
  try {
    info = await dev.hello();
  } catch (err) {
    if (err instanceof BroadlinkError && err.timeout) {
      throw new HttpError(502, `no answer from ${cfg.host}:${cfg.port}. Check the RM4 is on, and that the router forwards UDP port ${cfg.port} to it`, "device");
    }
    throw err;
  }
  const fields = ["mac", info.mac, "devtype", info.devtype, "name", info.name, "locked", info.locked ? "1" : "0", "checked", Date.now()];
  if (info.locked) {
    await command(["HSET", DEVICE_KEY, ...fields], env);
    throw new HttpError(409, "the RM4 is locked. In the Broadlink app open the device → ⋯ → Properties and turn off Lock device, then test again", "locked");
  }
  await dev.auth();
  await pipeline([["HSET", DEVICE_KEY, ...fields], ["SET", SESSION_KEY, JSON.stringify(dev.session()), "EX", SESSION_TTL_S]], env);
  return json({ ok: true, device: publicDevice(deviceConfig(env, [...(flat ?? []), ...fields.map(String)])) });
}

// --- GET /api/climate --------------------------------------------------------

function readLog(entries) {
  return (entries ?? [])
    .map((e) => e.split("|").map(Number))
    .filter(([at, t, h]) => at && Number.isFinite(t) && Number.isFinite(h))
    .map(([at, t, h]) => ({ at: at * 1000, t, h }))
    .reverse();
}

export async function climateGet(request, env) {
  const url = new URL(request.url);
  const { rest } = await requireUser(request, env, [...DEVICE_CMDS, ...CLIMATE_CMDS]);
  return json(await readClimate(env, rest, { fresh: url.searchParams.get("fresh") === "1" }));
}

/**
 * The room's climate from [device, session, now, log] results: the cached
 * reading when it's fresh enough, otherwise a new one from the RM4. Never
 * throws for device trouble; it answers {online: false} instead.
 */
export async function readClimate(env, [flat, rawSession, rawNow, log], { fresh = false } = {}) {
  const history = readLog(log);
  const cached = parse(rawNow);
  if (cached && !fresh) return { ok: true, online: true, ...cached, history, cached: true };

  let reading;
  try {
    reading = await withDevice(env, [flat, rawSession], (dev) => dev.sensors());
  } catch (err) {
    if (!(err instanceof BroadlinkError)) throw err;
    if (err.code === -4) return { ok: true, online: true, sensor: false, history };
    return { ok: true, online: false, error: err.message, history };
  }

  const now = Date.now();
  if (reading.temperature === 0 && reading.humidity === 0) return { ok: true, online: true, sensor: false, history };
  const snapshot = { sensor: true, temperature: reading.temperature, humidity: reading.humidity, at: now };
  const [, tick] = await pipeline([["SET", NOW_KEY, JSON.stringify(snapshot), "EX", NOW_TTL_S], ["SET", TICK_KEY, "1", "EX", LOG_EVERY_S, "NX"]], env);
  if (tick === "OK") {
    const entry = `${Math.round(now / 1000)}|${reading.temperature}|${reading.humidity}`;
    await pipeline([["LPUSH", LOG_KEY, entry], ["LTRIM", LOG_KEY, 0, LOG_KEEP - 1]], env);
    history.push({ at: now, t: reading.temperature, h: reading.humidity });
  }
  return { ok: true, online: true, ...snapshot, history };
}

// --- POST /api/send {remote, button} or {code} ------------------------------

export async function sendPost(request, env) {
  const data = await body(request);
  const buttonId = str(data.button, 16);
  const { rest } = await requireUser(request, env, [...DEVICE_CMDS, ["HGET", CODES_KEY, buttonId || "-"], ["GET", HOME_KEY], ["HGETALL", LIGHTS_KEY]]);
  const [flat, rawSession, storedCode, rawHome, lightsFlat] = rest;
  const repeat = Math.min(Math.max(Number(data.repeat) || 1, 1), 5);

  if (data.code !== undefined) {
    // Testing a code before it's saved.
    const code = parseCode(data.code);
    if (!code) throw new HttpError(400, "that doesn't look like a Broadlink code");
    await withDevice(env, [flat, rawSession], async (dev) => {
      for (let i = 0; i < repeat; i++) await dev.sendCode(code);
    });
    return json({ ok: true });
  }

  const home = await loadHome(env, rawHome);
  const remote = home.remotes.find((r) => r.buttons.some((b) => b.id === buttonId));
  const button = remote?.buttons.find((b) => b.id === buttonId);
  if (!button) throw new HttpError(404, "that button no longer exists");
  const lights = await pressButtons(env, [flat, rawSession], [{ remote, button, code: storedCode, repeat }], hash(lightsFlat) ?? {});
  return json({ ok: true, light: lights[remote.id] ?? null });
}

/**
 * Sends each press in turn ({remote, button, code, repeat}) over one device
 * session, then saves what any light buttons meant. Returns the lights.
 */
export async function pressButtons(env, deviceRest, presses, lights = {}) {
  for (const p of presses) {
    if (!p.code) throw new HttpError(404, `nothing is recorded on “${p.remote.name} / ${p.button.name}” yet`, "no_code");
    if (!parseCode(p.code)) throw new HttpError(500, `the code saved on “${p.button.name}” is damaged; record it again`);
  }
  const changed = {};
  await withDevice(env, deviceRest, async (dev) => {
    for (const [i, p] of presses.entries()) {
      if (i) await new Promise((r) => setTimeout(r, 250)); // devices miss codes sent back to back
      for (let n = 0; n < Math.min(Math.max(p.repeat || 1, 1), 5); n++) await dev.sendCode(parseCode(p.code));
      if (p.remote.category === "light") {
        const next = lightAfter(p.button, lights[p.remote.id]);
        if (next) lights[p.remote.id] = changed[p.remote.id] = next;
      }
    }
  });
  const fields = Object.entries(changed).flat();
  if (fields.length) await command(["HSET", LIGHTS_KEY, ...fields], env);
  return lights;
}

// --- POST /api/learn {action} ------------------------------------------------

/**
 * Learning is a few short calls the app makes in turn, since a function
 * shouldn't sit waiting for you to find the remote:
 *   IR:  ir → check, check, … until a code comes back
 *   RF:  rf_sweep → rf_freq, … until found (hold the button) →
 *        rf_find → check, … until a code comes back (press it again) → cancel
 */
export async function learnPost(request, env) {
  const data = await body(request);
  const { rest } = await requireUser(request, env, DEVICE_CMDS);

  return withDevice(env, rest, async (dev) => {
    switch (data.action) {
      case "ir":
        await dev.learnIr();
        return json({ ok: true });
      case "rf_sweep":
        await dev.sweepRf();
        return json({ ok: true });
      case "rf_freq":
        return json({ ok: true, ...(await dev.checkRfFrequency()) });
      case "rf_find": {
        const f = Number(data.frequency);
        await dev.findRfPacket(Number.isFinite(f) && f > 200 && f < 1000 ? f : undefined);
        return json({ ok: true });
      }
      case "check": {
        const code = await dev.checkData();
        return json({ ok: true, code: code ? code.toString("base64") : null, kind: code ? codeKind(code) : null, bytes: code?.length ?? 0 });
      }
      case "cancel":
        await dev.cancelRf().catch(() => {});
        return json({ ok: true });
      default:
        throw new HttpError(400, "unknown action");
    }
  });
}

