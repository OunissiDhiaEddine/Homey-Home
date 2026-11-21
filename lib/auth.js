/**
 * Homey Home's side of the shared sign-in.
 *
 * Signing in, signing up with an invite, passwords and the admin page are
 * HomeyDeck's (lib/accounts.js, POST /api/session). Both pages use its
 * session cookie, so one sign-in covers the whole site:
 *
 *   sess:{sha256(token)}    uid, 30 days after last use
 *   u:{uid}                 hash: name, role, pw, disabled, mustChange
 *
 * Homey Home's routes check the session here and, on top, that the user may
 * use the room controls (see access.js). Others get "no_access" and the app
 * sends them to the HomeyDeck page.
 */

import { pipeline, hash } from "./redis.js";
import { HttpError, cookie, setCookie } from "./http.js";
import { sessionParts, SESSION_COOKIE, SESSION_TTL_S } from "./accounts.js";
import { canUseHome } from "./access.js";

export { canUseHome, allowedUsers } from "./access.js";

export function checkUser(user, env) {
  if (user.disabled === "1") throw new HttpError(403, "this account is disabled", "disabled");
  if (!canUseHome(user, env)) throw new HttpError(403, "this account doesn't have access to Homey Home. The admin can add it to HOME_USERS", "no_access");
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

export const publicUser = (uid, user) => ({ id: uid, name: user.name, role: user.role, mustChange: user.mustChange === "1" });

/** Keeps the cookie's expiry in step with the session's (sliding 30 days). */
export function refreshCookie(request) {
  return setCookie(SESSION_COOKIE, cookie(request, SESSION_COOKIE), SESSION_TTL_S);
}
