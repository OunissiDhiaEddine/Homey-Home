/**
 * Sign-in with HomeyDeck accounts.
 *
 * Homey Home is connected to the same Upstash Redis as HomeyDeck, so it
 * reads HomeyDeck's users directly and stores its sessions the same way:
 *
 *   uname:{lowercase name}  uid                       (HomeyDeck's)
 *   u:{uid}                 hash: name, role, pw, disabled, mustChange   (HomeyDeck's)
 *   sess:{sha256(token)}    uid, 30 days after last use
 *   sessions:{uid}          the user's session keys
 *
 * Because Homey Home's sessions sit in sessions:{uid} too, HomeyDeck's
 * "sign out everywhere", a password change and disabling or deleting the
 * account all sign you out of Homey Home as well. Accounts are created and
 * managed in HomeyDeck only.
 *
 * Who may use Homey Home: the HomeyDeck admin, plus the usernames listed
 * in HOME_USERS (comma separated). Your friends with HomeyDeck invites
 * can't touch your lights.
 */

import { pipeline, command, hash } from "./redis.js";
import { HttpError, json, body, cookie, setCookie, str } from "./http.js";
import { randomId, sha256, checkPassword } from "./secrets.js";

export const SESSION_COOKIE = "hh_session";
export const SESSION_TTL_S = 30 * 24 * 3600;
const ID_RE = /^[A-Za-z0-9_-]{22}$/;

export const homeydeckUrl = (env) => (env.HOMEYDECK_URL || "https://homeydeck.vercel.app").replace(/\/+$/, "");

export function allowedUsers(env) {
  return String(env.HOME_USERS ?? "")
    .split(/[,\s]+/)
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean);
}

export function canUseHome(user, env) {
  return user.role === "admin" || allowedUsers(env).includes(String(user.name).toLowerCase());
}

export function checkUser(user, env) {
  if (user.disabled === "1") throw new HttpError(403, "this account is disabled", "disabled");
  if (!canUseHome(user, env)) throw new HttpError(403, "this HomeyDeck account doesn't have access to Homey Home. The admin can add it to HOME_USERS", "no_access");
}

/** The uid and session key from the cookie, without touching the database. */
export function sessionParts(request) {
  const raw = cookie(request, SESSION_COOKIE);
  const dot = raw.indexOf(".");
  const uid = raw.slice(0, dot);
  const token = raw.slice(dot + 1);
  if (dot < 0 || !ID_RE.test(uid) || token.length < 40) throw new HttpError(401, "please sign in", "signed_out");
  return { uid, key: `sess:${sha256(token)}` };
}

/**
 * Checks the session and loads the user, running `extra` commands in the
 * same round trip. Returns the user and the extra results.
 */
export async function requireUser(request, env, extra = [], { slide = false } = {}) {
  const { uid, key } = sessionParts(request);
  const first = slide ? ["GETEX", key, "EX", SESSION_TTL_S] : ["GET", key];
  const [owner, flat, ...rest] = await pipeline([first, ["HGETALL", `u:${uid}`], ...extra], env);
  const user = hash(flat);
  if (owner !== uid || !user) throw new HttpError(401, "please sign in", "signed_out");
  checkUser(user, env);
  return { uid, user, rest };
}

export const publicUser = (uid, user) => ({ id: uid, name: user.name, role: user.role });

async function startSession(uid, env) {
  const token = randomId(32);
  const key = `sess:${sha256(token)}`;
  await pipeline([["SET", key, uid, "EX", SESSION_TTL_S], ["SADD", `sessions:${uid}`, key]], env);
  return setCookie(SESSION_COOKIE, `${uid}.${token}`, SESSION_TTL_S);
}

/** POST /api/session {action: "login", username, password} or {action: "logout"}. */
export async function sessionPost(request, env) {
  const data = await body(request);

  if (data.action === "logout") {
    let parts = null;
    try {
      parts = sessionParts(request);
    } catch {}
    if (parts) await pipeline([["DEL", parts.key], ["SREM", `sessions:${parts.uid}`, parts.key]], env);
    return json({ ok: true }, 200, { "Set-Cookie": setCookie(SESSION_COOKIE, "", 0) });
  }

  if (data.action === "login") {
    const name = str(data.username, 64);
    const password = typeof data.password === "string" ? data.password : "";
    const wrong = new HttpError(401, "wrong username or password", "bad_login");
    if (!name || !password) throw wrong;
    const uid = await command(["GET", `uname:${name.toLowerCase()}`], env);
    const user = uid ? hash(await command(["HGETALL", `u:${uid}`], env)) : null;
    // checkPassword takes as long for a missing user, so names can't be probed by timing.
    if (!(await checkPassword(password, user?.pw)) || !user) throw wrong;
    checkUser(user, env);
    const cookieHeader = await startSession(uid, env);
    return json({ ok: true, user: publicUser(uid, user) }, 200, { "Set-Cookie": cookieHeader });
  }

  throw new HttpError(400, "unknown action");
}

/** Keeps the cookie's expiry in step with the session's (sliding 30 days). */
export function refreshCookie(request) {
  return setCookie(SESSION_COOKIE, cookie(request, SESSION_COOKIE), SESSION_TTL_S);
}
