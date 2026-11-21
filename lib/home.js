/**
 * The home: one room for now, with remotes (TV, AC, light, …) whose buttons
 * hold learned IR/RF codes.
 *
 *   hh:home    JSON {room, remotes: [{id, name, category, pinned, buttons: [{id, name, icon, kind}]}]}
 *   hh:codes   hash: button id → the code, Broadlink base64
 *
 * Codes live apart from the layout so opening the app doesn't download every
 * code, and a button press reads just the one it needs. A button's `kind` is
 * "ir", "rf" or null when nothing is recorded yet.
 */

import { pipeline, command } from "./redis.js";
import { HttpError, json, body, parse, str } from "./http.js";
import { randomId } from "./secrets.js";
import { requireUser } from "./auth.js";
import { parseCode, codeKind } from "./broadlink.js";

export const HOME_KEY = "hh:home";
export const CODES_KEY = "hh:codes";
export const LIGHTS_KEY = "hh:lights";
const MAX_REMOTES = 40;
const MAX_BUTTONS = 80;

export const CATEGORIES = {
  light: { label: "Light", icon: "bulb" },
  tv: { label: "TV", icon: "tv" },
  ac: { label: "Air conditioner", icon: "ac" },
  fan: { label: "Fan", icon: "fan" },
  speaker: { label: "Speaker", icon: "speaker" },
  projector: { label: "Projector", icon: "projector" },
  box: { label: "TV box", icon: "box" },
  other: { label: "Other", icon: "remote" },
};

export const ICONS = [
  "none", "power", "bulb", "sun", "moon", "plus", "minus", "up", "down", "left", "right", "ok",
  "volume", "mute", "snow", "flame", "fan", "swing", "mode", "timer", "temp", "drop", "input",
  "home", "back", "play", "pause", "star", "tv", "ac", "speaker", "projector", "box", "remote",
];

// Buttons a new remote starts with; each one is recorded later.
const TEMPLATES = {
  light: [["On", "bulb"], ["Off", "power"], ["Brighter", "sun"], ["Dimmer", "moon"]],
  tv: [["Power", "power"], ["Vol +", "volume"], ["Vol −", "minus"], ["Mute", "mute"], ["Ch +", "up"], ["Ch −", "down"], ["Input", "input"], ["Home", "home"], ["Up", "up"], ["Left", "left"], ["OK", "ok"], ["Right", "right"], ["Back", "back"], ["Down", "down"]],
  ac: [["Power", "power"], ["Cool", "snow"], ["Heat", "flame"], ["Temp +", "plus"], ["Temp −", "minus"], ["Fan", "fan"], ["Mode", "mode"], ["Swing", "swing"]],
  fan: [["Power", "power"], ["Speed", "fan"], ["Swing", "swing"], ["Timer", "timer"]],
  speaker: [["Power", "power"], ["Vol +", "volume"], ["Vol −", "minus"], ["Mute", "mute"], ["Input", "input"], ["Play", "play"]],
  projector: [["Power", "power"], ["Input", "input"], ["Up", "up"], ["Down", "down"], ["OK", "ok"], ["Back", "back"]],
  box: [["Power", "power"], ["Home", "home"], ["Back", "back"], ["Up", "up"], ["Left", "left"], ["OK", "ok"], ["Right", "right"], ["Down", "down"], ["Play", "play"], ["Ch +", "up"], ["Ch −", "down"]],
  other: [["Power", "power"]],
};

const newId = () => randomId(6);

/**
 * IR lights don't report back, so we remember what the last button meant:
 * "off" for Off, "on" for On (or Brighter, Warm, …), a flip for Power/Toggle.
 */
export function lightAfter(button, current) {
  const name = String(button.name).toLowerCase();
  if (/\boff\b/.test(name)) return "off";
  if (/\bon\b/.test(name) || /bright|warm|cool|night/.test(name)) return "on";
  if (button.icon === "power" || /power|toggle/.test(name)) return current === "on" ? "off" : "on";
  return null;
}
const makeButtons = (category) => (TEMPLATES[category] ?? TEMPLATES.other).map(([name, icon]) => ({ id: newId(), name, icon, kind: null }));

/** The first time: your room, with a light that's waiting to be recorded. */
export function defaultHome() {
  return {
    room: "My Room",
    remotes: [{ id: newId(), name: "Room light", category: "light", pinned: true, buttons: makeButtons("light") }],
  };
}

export async function loadHome(env, raw) {
  const home = parse(raw === undefined ? await command(["GET", HOME_KEY], env) : raw);
  if (home?.remotes) return home;
  const fresh = defaultHome();
  await command(["SET", HOME_KEY, JSON.stringify(fresh), "NX"], env);
  return parse(await command(["GET", HOME_KEY], env)) ?? fresh;
}

const findRemote = (home, id) => {
  const remote = home.remotes.find((r) => r.id === id);
  if (!remote) throw new HttpError(404, "that remote no longer exists");
  return remote;
};

const findButton = (remote, id) => {
  const button = remote.buttons.find((b) => b.id === id);
  if (!button) throw new HttpError(404, "that button no longer exists");
  return button;
};

const cleanName = (v, fallback) => str(v, 40) || fallback;
const cleanIcon = (v) => (ICONS.includes(v) ? v : "none");
const cleanCategory = (v) => (CATEGORIES[v] ? v : "other");

function move(list, item, dir) {
  const i = list.indexOf(item);
  const j = i + (dir === "up" || dir === "left" ? -1 : 1);
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
}

/** POST /api/home {action, …}: every edit answers with the whole home. */
export async function homePost(request, env) {
  const { rest } = await requireUser(request, env, [["GET", HOME_KEY]]);
  const home = await loadHome(env, rest[0]);
  const data = await body(request);
  const extra = []; // code writes that go with the layout

  switch (data.action) {
    case "room_rename":
      home.room = cleanName(data.name, "My Room");
      break;

    case "remote_add": {
      if (home.remotes.length >= MAX_REMOTES) throw new HttpError(409, `up to ${MAX_REMOTES} remotes`);
      const category = cleanCategory(data.category);
      const remote = {
        id: newId(),
        name: cleanName(data.name, CATEGORIES[category].label),
        category,
        pinned: Boolean(data.pinned),
        buttons: data.blank ? [] : makeButtons(category),
      };
      home.remotes.push(remote);
      return save(env, home, extra, { remote: remote.id });
    }

    case "remote_update": {
      const remote = findRemote(home, data.remote);
      if (data.name !== undefined) remote.name = cleanName(data.name, remote.name);
      if (data.category !== undefined) remote.category = cleanCategory(data.category);
      if (data.pinned !== undefined) remote.pinned = Boolean(data.pinned);
      break;
    }

    case "remote_move":
      move(home.remotes, findRemote(home, data.remote), data.dir);
      break;

    case "remote_delete": {
      const remote = findRemote(home, data.remote);
      home.remotes = home.remotes.filter((r) => r !== remote);
      if (remote.buttons.length) extra.push(["HDEL", CODES_KEY, ...remote.buttons.map((b) => b.id)]);
      extra.push(["HDEL", LIGHTS_KEY, remote.id]);
      break;
    }

    case "button_add": {
      const remote = findRemote(home, data.remote);
      if (remote.buttons.length >= MAX_BUTTONS) throw new HttpError(409, `up to ${MAX_BUTTONS} buttons on a remote`);
      const button = { id: newId(), name: cleanName(data.name, "Button"), icon: cleanIcon(data.icon), kind: null };
      remote.buttons.push(button);
      if (data.code) extra.push(...saveCode(button, data.code));
      return save(env, home, extra, { button: button.id });
    }

    case "button_update": {
      const button = findButton(findRemote(home, data.remote), data.button);
      if (data.name !== undefined) button.name = cleanName(data.name, button.name);
      if (data.icon !== undefined) button.icon = cleanIcon(data.icon);
      break;
    }

    case "button_move": {
      const remote = findRemote(home, data.remote);
      move(remote.buttons, findButton(remote, data.button), data.dir);
      break;
    }

    case "button_delete": {
      const remote = findRemote(home, data.remote);
      const button = findButton(remote, data.button);
      remote.buttons = remote.buttons.filter((b) => b !== button);
      extra.push(["HDEL", CODES_KEY, button.id]);
      break;
    }

    case "button_code": {
      const button = findButton(findRemote(home, data.remote), data.button);
      extra.push(...saveCode(button, data.code));
      break;
    }

    case "button_clear": {
      const button = findButton(findRemote(home, data.remote), data.button);
      button.kind = null;
      extra.push(["HDEL", CODES_KEY, button.id]);
      break;
    }

    case "button_export": {
      // The code itself, so it can be copied into Home Assistant or a backup.
      const remote = findRemote(home, data.remote);
      const button = findButton(remote, data.button);
      const code = await command(["HGET", CODES_KEY, button.id], env);
      if (!code) throw new HttpError(404, "nothing is recorded on that button yet");
      return json({ ok: true, code });
    }

    default:
      throw new HttpError(400, "unknown action");
  }
  return save(env, home, extra);
}

function saveCode(button, text) {
  const code = parseCode(text);
  if (!code) throw new HttpError(400, "that doesn't look like a Broadlink code (base64 or hex)");
  const kind = codeKind(code);
  button.kind = kind === "unknown" ? "ir" : kind;
  return [["HSET", CODES_KEY, button.id, code.toString("base64")]];
}

async function save(env, home, extra, more = {}) {
  await pipeline([["SET", HOME_KEY, JSON.stringify(home)], ...extra], env);
  return json({ ok: true, home, ...more });
}
