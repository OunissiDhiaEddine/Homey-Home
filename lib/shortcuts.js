/**
 * Siri & Shortcuts.
 *
 * Apple's Shortcuts app can't sign in with a cookie, so it uses a token you
 * make in Settings. A token is "<uid>.<secret>"; only SHA-256(secret) is kept:
 *
 *   hh:token:{id}          uid, where id = sha256(secret)
 *   hh:tokenmeta:{uid}     hash: id → JSON {name, created}
 *   hh:tokenused:{uid}     hash: id → when it was last used
 *
 * The Shortcut calls POST /api/shortcut with "Authorization: Bearer <token>"
 * and a JSON (or form) body:
 *
 *   {"press": "Room light / On"}                     one button
 *   {"press": ["Room light / Off", "AC / Power"]}    a scene, in order
 *   {"press": "TV / Vol +", "repeat": 3}             the same button 3 times
 *   {"get": "climate"}                               "My Room is 23.4 °C with 48 % humidity."
 *
 * Names are matched without caring about case or spacing, and the remote can
 * be left out when only one remote has a button by that name. The answer is
 * plain text, so the Shortcut can show it or have Siri speak it.
 */

import { pipeline, command, hash, RedisError } from "./redis.js";
import { HttpError, json, body, str } from "./http.js";
import { BroadlinkError } from "./broadlink.js";
import { requireUser, checkUser } from "./auth.js";
import { randomId, sha256 } from "./secrets.js";
import { HOME_KEY, CODES_KEY, LIGHTS_KEY, loadHome } from "./home.js";
import { DEVICE_CMDS, readClimate, pressButtons } from "./device.js";

const MAX_TOKENS = 10;
const MAX_PRESSES = 10;
const UID_RE = /^[A-Za-z0-9_-]{22}$/;
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;

const metaKey = (uid) => `hh:tokenmeta:${uid}`;
const usedKey = (uid) => `hh:tokenused:${uid}`;

// --- managing tokens from the app (POST /api/tokens) ---------------------------

export async function tokensPost(request, env) {
  const { uid } = await requireUser(request, env);
  const data = await body(request);

  if (data.action === "list") return json({ ok: true, tokens: await listTokens(uid, env) });

  if (data.action === "create") {
    const count = await command(["HLEN", metaKey(uid)], env);
    if (count >= MAX_TOKENS) throw new HttpError(409, `up to ${MAX_TOKENS} tokens; revoke one you don't use first`);
    const secret = randomId(32);
    const id = sha256(secret);
    const name = str(data.name, 40) || "Shortcuts";
    await pipeline([["SET", `hh:token:${id}`, uid], ["HSET", metaKey(uid), id, JSON.stringify({ name, created: Date.now() })]], env);
    return json({ ok: true, token: `${uid}.${secret}`, tokens: await listTokens(uid, env) });
  }

  if (data.action === "revoke") {
    const id = str(data.id, 64);
    await pipeline([["DEL", `hh:token:${id}`], ["HDEL", metaKey(uid), id], ["HDEL", usedKey(uid), id]], env);
    return json({ ok: true, tokens: await listTokens(uid, env) });
  }

  throw new HttpError(400, "unknown action");
}

async function listTokens(uid, env) {
  const [meta, used] = await pipeline([["HGETALL", metaKey(uid)], ["HGETALL", usedKey(uid)]], env);
  const lastUsed = hash(used) ?? {};
  return Object.entries(hash(meta) ?? {})
    .map(([id, raw]) => {
      let m = {};
      try {
        m = JSON.parse(raw);
      } catch {}
      return { id, name: m.name || "Shortcuts", created: m.created || 0, lastUsed: Number(lastUsed[id]) || null };
    })
    .sort((a, b) => a.created - b.created);
}

// --- the endpoint Shortcuts calls (POST /api/shortcut) -------------------------

const text = (message, status = 200) =>
  new Response(message.endsWith("\n") ? message : `${message}\n`, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

const sentence = (s) => {
  const t = String(s || "").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? "" : ".") : "Something went wrong.";
};

/** Wraps the handler: every answer, errors included, is one plain sentence. */
export function shortcutRoute(handler) {
  return async (request, env = process.env) => {
    try {
      return await handler(request, env);
    } catch (err) {
      if (err instanceof HttpError) return text(sentence(err.message), err.status);
      if (err instanceof BroadlinkError) return text(sentence(err.timeout ? "I can't reach the RM4 right now" : err.message), 502);
      if (err instanceof RedisError) return text("The database isn't answering. Try again in a moment.", 503);
      console.error(err);
      return text("Something went wrong on the server.", 500);
    }
  };
}

/** Reads a JSON or form body: Shortcuts can send either. */
async function shortcutBody(request) {
  const type = (request.headers.get("content-type") ?? "").toLowerCase();
  if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    if (!form) throw new HttpError(400, "the request body couldn't be read");
    const press = form.getAll("press").map(String);
    return { press: press.length > 1 ? press : press[0], get: form.get("get") ?? undefined, repeat: form.get("repeat") ?? undefined };
  }
  const data = await request.json().catch(() => null);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new HttpError(400, "send a JSON body like {\"press\": \"Room light / On\"} or {\"get\": \"climate\"}");
  }
  return data;
}

function bearer(request) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  const [uid, secret, extra] = token.split(".");
  if (extra !== undefined || !UID_RE.test(uid ?? "") || !SECRET_RE.test(secret ?? "")) {
    throw new HttpError(401, "add the header Authorization: Bearer followed by a token from Homey Home → Settings → Siri & Shortcuts");
  }
  return { uid, id: sha256(secret) };
}

const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[−–—]/g, "-") // − – — all mean minus
    .replace(/\s+/g, " ")
    .replace(/\s*([+-])\s*$/, " $1")
    .trim();

/** "Room light / On" → {remote, button}. The remote part is optional. */
export function resolvePress(home, spec) {
  const raw = str(spec, 120);
  if (!raw) throw new HttpError(400, "say which button to press, like “Room light / On”");
  const slash = raw.lastIndexOf("/");
  const remoteName = slash >= 0 ? raw.slice(0, slash) : "";
  const buttonName = slash >= 0 ? raw.slice(slash + 1) : raw;
  const remotes = remoteName.trim() ? home.remotes.filter((r) => norm(r.name) === norm(remoteName)) : home.remotes;
  if (!remotes.length) {
    throw new HttpError(404, `there's no remote called “${remoteName.trim()}”. You have: ${home.remotes.map((r) => r.name).join(", ")}`);
  }
  const matches = remotes.flatMap((remote) => remote.buttons.filter((b) => norm(b.name) === norm(buttonName)).map((button) => ({ remote, button })));
  if (!matches.length) {
    const where = remotes.length === 1 ? ` on ${remotes[0].name}. It has: ${remotes[0].buttons.map((b) => b.name).join(", ")}` : "";
    throw new HttpError(404, `there's no button called “${buttonName.trim()}”${where}`);
  }
  if (matches.length > 1) {
    throw new HttpError(409, `“${buttonName.trim()}” is on ${matches.map((m) => m.remote.name).join(" and ")}. Say which, like “${matches[0].remote.name} / ${matches[0].button.name}”`);
  }
  return matches[0];
}

function climateSentence(room, c) {
  if (!c.online) return "I can't reach the RM4 right now.";
  if (!c.sensor) return "There's no temperature sensor plugged into the RM4.";
  return `${room} is ${c.temperature.toFixed(1)} °C with ${Math.round(c.humidity)} % humidity.`;
}

export async function shortcutPost(request, env) {
  const { uid, id } = bearer(request);
  const data = await shortcutBody(request);
  const [owner, userFlat, rawHome, deviceFlat, rawSession, lightsFlat, rawNow] = await pipeline(
    [["GET", `hh:token:${id}`], ["HGETALL", `u:${uid}`], ["GET", HOME_KEY], ...DEVICE_CMDS, ["HGETALL", LIGHTS_KEY], ["GET", "hh:climate:now"]],
    env,
  );
  const user = hash(userFlat);
  if (owner !== uid || !user) throw new HttpError(401, "that token was revoked or is wrong. Make a new one in Homey Home → Settings");
  checkUser(user, env);
  const home = await loadHome(env, rawHome);
  const room = home.room || "Your room";

  if (data.get !== undefined) {
    if (String(data.get).toLowerCase() !== "climate") throw new HttpError(400, "“get” can only be “climate” for now");
    await command(["HSET", usedKey(uid), id, Date.now()], env);
    const c = await readClimate(env, [deviceFlat, rawSession, rawNow]);
    return text(climateSentence(room, c));
  }

  const specs = Array.isArray(data.press) ? data.press : data.press !== undefined ? [data.press] : [];
  if (!specs.length) throw new HttpError(400, "send {\"press\": \"Room light / On\"} or {\"get\": \"climate\"}");
  if (specs.length > MAX_PRESSES) throw new HttpError(400, `up to ${MAX_PRESSES} buttons at once`);
  const repeat = Math.min(Math.max(Number(data.repeat) || 1, 1), 5);
  const picks = specs.map((s) => resolvePress(home, s));

  const [codes] = await pipeline([["HMGET", CODES_KEY, ...picks.map((p) => p.button.id)], ["HSET", usedKey(uid), id, Date.now()]], env);
  const presses = picks.map((p, i) => ({ ...p, code: codes[i], repeat }));
  const lights = await pressButtons(env, [deviceFlat, rawSession], presses, hash(lightsFlat) ?? {});

  if (presses.length === 1) {
    const { remote, button } = presses[0];
    if (remote.category === "light" && lights[remote.id]) return text(`${remote.name} is ${lights[remote.id]}.`);
    return text(`Done: ${remote.name}, ${button.name}.`);
  }
  return text(`Done: ${presses.map((p) => `${p.remote.name} ${p.button.name}`).join(", then ")}.`);
}
