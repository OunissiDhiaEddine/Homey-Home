// All of Homey Home's API in one function. Vercel's Hobby plan allows 12
// functions per deployment and HomeyDeck's API uses 10, so vercel.json
// rewrites /api/climate, /api/device, /api/learn, /api/send, /api/tokens and
// /api/shortcut here (with ?route=…), and this picks the handler.
import { route, json } from "../lib/http.js";
import { homePost } from "../lib/home.js";
import { homeGet, devicePost, climateGet, sendPost, learnPost } from "../lib/device.js";
import { tokensPost, shortcutRoute, shortcutPost } from "../lib/shortcuts.js";

const ROUTES = {
  home: { GET: route(homeGet), POST: route(homePost) },
  device: { POST: route(devicePost) },
  climate: { GET: route(climateGet) },
  send: { POST: route(sendPost) },
  learn: { POST: route(learnPost) },
  tokens: { POST: route(tokensPost) },
  shortcut: { POST: shortcutRoute(shortcutPost) }, // Siri: bearer token, plain-text answers
};

/** The route from ?route= (after a rewrite) or the path's last part (/api/climate). */
export function routeName(request) {
  const url = new URL(request.url);
  return url.searchParams.get("route") || url.pathname.replace(/\/+$/, "").split("/").pop();
}

const dispatch = (method) => (request) => {
  const handlers = ROUTES[routeName(request)];
  if (!handlers) return json({ ok: false, error: "not found" }, 404);
  if (!handlers[method]) return json({ ok: false, error: "method not allowed" }, 405);
  return handlers[method](request);
};

export const GET = dispatch("GET");
export const POST = dispatch("POST");
