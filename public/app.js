// Homey Home PWA. Talks to the API on the same origin. Signing in sets an
// HttpOnly session cookie, so the app itself never holds a secret.

const CLIMATE_EVERY_MS = 60_000;
const LEARN_POLL_MS = 1200;
const IR_WINDOW_MS = 30_000;
const RF_SWEEP_WINDOW_MS = 30_000;
const RF_PRESS_WINDOW_MS = 20_000;
const LONG_PRESS_MS = 550;

// --- icons -------------------------------------------------------------------

const ICONS = {
  house: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 9.8V20h13V9.8"/><path d="M10 20v-5.5h4V20"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  rec: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/>',
  send: '<path d="M4 12h12"/><path d="m11 6 6 6-6 6"/><path d="M20 5v14"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  wave: '<path d="M12 12v9"/><circle cx="12" cy="10" r="1.6"/><path d="M8.5 6.5a5 5 0 0 0 0 7M15.5 6.5a5 5 0 0 1 0 7M5.6 3.6a9 9 0 0 0 0 12.8M18.4 3.6a9 9 0 0 1 0 12.8"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
  temp: '<path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z"/><path d="M12 9v7"/>',
  drop: '<path d="M12 3.5s6 6.3 6 10.8a6 6 0 0 1-12 0c0-4.5 6-10.8 6-10.8z"/>',
  power: '<path d="M12 3v8"/><path d="M6.6 6.6a7.6 7.6 0 1 0 10.8 0"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  left: '<path d="m15 6-6 6 6 6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  ok: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.5"/>',
  volume: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  mute: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6M16 9l6 6"/>',
  snow: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7"/><path d="m9 4 3 2 3-2M9 20l3-2 3 2"/>',
  flame: '<path d="M12 22c4 0 7-2.7 7-6.5 0-3.6-2.6-5.8-4-8.5-.6 2-1.6 3-3 3.5C12.5 7 11.5 4 9 2c0 4-4 6.5-4 12 0 4.5 3 8 7 8z"/>',
  fan: '<circle cx="12" cy="12" r="1.8"/><path d="M12 10.2C11 6.5 12 3 15 3c2.2 0 2.8 2.4 1.2 4L13.8 10M13.8 12c3.7-1 7.2 0 7.2 3 0 2.2-2.4 2.8-4 1.2L14 13.8M12 13.8c1 3.7 0 7.2-3 7.2-2.2 0-2.8-2.4-1.2-4L10.2 14M10.2 12C6.5 13 3 12 3 9c0-2.2 2.4-2.8 4-1.2L10 10.2"/>',
  swing: '<path d="M5 16a7 7 0 0 1 14 0"/><path d="m2.5 13.5 2.5 3 3-2.2M21.5 13.5l-2.5 3-3-2.2"/><path d="M12 16V9"/>',
  mode: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2h5"/>',
  input: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 7.5v5M9.5 10.5 12 13l2.5-2.5M8 20h8"/>',
  home: '<path d="m3 11 9-7.5 9 7.5"/><path d="M5.5 9.5V20h13V9.5"/>',
  back: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  play: '<path d="M7 4.5v15l12.5-7.5z"/>',
  pause: '<path d="M8.5 5v14M15.5 5v14"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  tv: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>',
  ac: '<rect x="2.5" y="4.5" width="19" height="9" rx="2"/><path d="M6 10h12M8 17l-1 3M12 17v3.5M16 17l1 3"/>',
  speaker: '<rect x="6" y="3" width="12" height="18" rx="2.5"/><circle cx="12" cy="14" r="3"/><circle cx="12" cy="7.5" r="1"/>',
  projector: '<rect x="2" y="8" width="20" height="9" rx="2.5"/><circle cx="16" cy="12.5" r="2.5"/><path d="M5.5 12.5h4M6 17v2M18 17v2"/>',
  box: '<rect x="3" y="8.5" width="18" height="8" rx="2"/><path d="M7 12.5h2M15 12.5h2"/>',
  remote: '<rect x="8" y="2.5" width="8" height="19" rx="3"/><circle cx="12" cy="7" r="1.5"/><path d="M11 12h2M11 15h2M11 18h2"/>',
};

const ICON_ORDER = ["none", "power", "bulb", "sun", "moon", "plus", "minus", "up", "down", "left", "right", "ok", "volume", "mute", "snow", "flame", "fan", "swing", "mode", "timer", "temp", "drop", "input", "home", "back", "play", "pause", "star", "tv", "ac", "speaker", "projector", "box", "remote"];

const CATEGORIES = {
  light: { label: "Light", icon: "bulb", color: "#ffc65c" },
  tv: { label: "TV", icon: "tv", color: "#66a6ff" },
  ac: { label: "AC", icon: "ac", color: "#5cd6ff" },
  fan: { label: "Fan", icon: "fan", color: "#4dd9b0" },
  speaker: { label: "Speaker", icon: "speaker", color: "#b38cff" },
  projector: { label: "Projector", icon: "projector", color: "#ff8c8c" },
  box: { label: "TV box", icon: "box", color: "#8ca0ff" },
  other: { label: "Other", icon: "remote", color: "#a8adc4" },
};
const cat = (key) => CATEGORIES[key] ?? CATEGORIES.other;

function icon(name) {
  const span = document.createElement("span");
  span.innerHTML = `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] ?? ""}</svg>`; // constant markup only
  return span.firstChild;
}

function fillIcons(root = document) {
  for (const host of root.querySelectorAll("[data-icon]")) {
    if (!host.querySelector("svg")) host.prepend(icon(host.dataset.icon));
  }
}

// --- small DOM helpers ---------------------------------------------------------

const $ = (id) => document.getElementById(id);

/** el("button", {class: "key", onclick}, child, "text") — text is always set as text. */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k === "style") for (const [p, val] of Object.entries(v)) node.style.setProperty(p, val);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function storageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

// --- state and API -------------------------------------------------------------

const state = {
  user: null,
  home: null,
  device: null,
  homeydeckUrl: "https://homeydeck.vercel.app",
  climate: null,
  deviceState: "checking", // checking | online | offline | none
  climateTimer: null,
  remote: null, // the open remote's id
  editing: false,
  button: null, // {remote, button} in the button sheet
};

class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function api(path, body) {
  let res;
  try {
    res = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(navigator.onLine ? "Can't reach the server." : "You're offline.", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    const err = new ApiError(friendly(data.error) || `The server answered ${res.status}.`, res.status, data.code);
    if (["signed_out", "disabled", "no_access"].includes(data.code) && state.user) signedOut(err.message);
    throw err;
  }
  return data;
}

function friendly(error) {
  if (!error) return "";
  return error.charAt(0).toUpperCase() + error.slice(1) + (/[.!?]$/.test(error) ? "" : ".");
}

let toastTimer = null;
function toast(message, kind = "error") {
  $("toast-text").textContent = message;
  $("toast").dataset.kind = kind;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), kind === "info" ? 2500 : 6000);
}
$("toast-close").addEventListener("click", () => ($("toast").hidden = true));

// --- session -------------------------------------------------------------------

async function loadSession() {
  try {
    const data = await api("/api/session");
    applySession(data);
    showView("app");
    refreshClimate();
    startClimate();
    return true;
  } catch (err) {
    if (err.status === 401 || err.status === 403) showView("auth");
    else {
      showView("auth");
      $("login-error").textContent = err.message;
    }
    return false;
  }
}

function applySession(data) {
  state.user = data.user;
  state.home = data.home;
  state.device = data.device;
  state.homeydeckUrl = data.homeydeckUrl || state.homeydeckUrl;
  for (const id of ["deck-link", "settings-deck", "auth-deck-link"]) $(id).href = state.homeydeckUrl;
  if (!state.device.configured) setDeviceState("none");
  render();
}

function signedOut(message) {
  stopClimate();
  state.user = null;
  state.home = null;
  closeAllSheets();
  showView("auth");
  if (message && !/sign in/i.test(message)) $("login-error").textContent = message;
}

function showView(view) {
  document.body.dataset.view = view;
  $("auth").hidden = view !== "auth";
  $("app").hidden = view !== "app";
  if (view === "auth") checkServer();
}

async function checkServer() {
  try {
    const res = await fetch("/api/health", { cache: "no-store" });
    const h = await res.json();
    if (!h.database) {
      $("server-notice-text").textContent = "Connect HomeyDeck's Upstash Redis database to this Vercel project (Storage → Connect), then redeploy. Sharing it is what lets you sign in with your HomeyDeck account.";
      $("server-notice").hidden = false;
    } else $("server-notice").hidden = true;
  } catch {}
}

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = e.submitter ?? $("login-form").querySelector("button[type=submit]");
  $("login-error").textContent = "";
  button.disabled = true;
  try {
    await api("/api/session", { action: "login", username: $("login-name").value.trim(), password: $("login-password").value });
    $("login-password").value = "";
    await loadSession();
  } catch (err) {
    $("login-error").textContent = err.message;
  } finally {
    button.disabled = false;
  }
});

$("sign-out").addEventListener("click", async () => {
  try {
    await api("/api/session", { action: "logout" });
  } catch {}
  signedOut();
});

// --- dashboard -----------------------------------------------------------------

function setDeviceState(s, detail) {
  state.deviceState = s;
  document.body.dataset.device = s;
  const name = state.device?.name || state.device?.model || "RM4 Pro";
  $("device-state").textContent =
    s === "online" ? `${name} online` : s === "offline" ? detail || "Can't reach the RM4" : s === "none" ? "RM4 not set up yet" : "Checking…";
  $("setup-card").hidden = s !== "none";
}

function render() {
  if (!state.home) return;
  $("room-name").textContent = state.home.room || "My Room";
  renderPinned();
  renderRemoteList();
  renderLightGlow();
  if (!$("remote-sheet").hidden) renderRemoteSheet();
}

const learnedCount = (remote) => remote.buttons.filter((b) => b.kind).length;

function remoteSubtitle(remote) {
  const total = remote.buttons.length;
  const learned = learnedCount(remote);
  if (!total) return "No buttons yet";
  if (!learned) return "Tap a button to record it";
  if (remote.category === "light") {
    const on = lightState(remote.id);
    if (on) return on === "on" ? "On" : "Off";
  }
  return learned === total ? `${total} buttons` : `${learned} of ${total} recorded`;
}

function renderPinned() {
  const host = $("pinned");
  host.replaceChildren();
  for (const remote of state.home.remotes.filter((r) => r.pinned)) {
    const c = cat(remote.category);
    const card = el(
      "section",
      { class: "card remote-card", style: { "--c": c.color }, "data-on": remote.category === "light" ? lightState(remote.id) ?? "" : "" },
      el(
        "div",
        { class: "remote-head" },
        el("span", { class: "cat-icon", style: { "--c": c.color } }, icon(c.icon)),
        el("div", { class: "remote-title" }, el("h2", {}, remote.name), el("p", {}, remoteSubtitle(remote))),
        el("button", { class: "icon-btn small", "aria-label": `Edit ${remote.name}`, onclick: () => openRemote(remote.id, true) }, icon("edit")),
      ),
      padFor(remote, false),
    );
    host.append(card);
  }
}

function renderRemoteList() {
  const host = $("remote-list");
  host.replaceChildren();
  for (const remote of state.home.remotes) {
    const c = cat(remote.category);
    host.append(
      el(
        "button",
        { class: "remote-tile", type: "button", onclick: () => openRemote(remote.id) },
        el("span", { class: "cat-icon", style: { "--c": c.color } }, icon(c.icon)),
        el("strong", {}, remote.name),
        el("span", {}, remoteSubtitle(remote)),
      ),
    );
  }
  host.append(el("button", { class: "remote-tile add", type: "button", onclick: openAdd }, icon("add"), el("span", {}, "Add remote")));
}

// --- buttons -------------------------------------------------------------------

function keyFor(remote, button, editing) {
  const c = cat(remote.category);
  const face = button.icon && button.icon !== "none" ? icon(button.icon) : el("span", { class: "glyph" }, (button.name || "?").slice(0, 3));
  const key = el(
    "button",
    { class: `key${button.kind ? "" : " empty"}`, type: "button", style: { "--c": c.color }, "aria-label": button.kind ? button.name : `${button.name}, not recorded yet` },
    face,
    el("span", { class: "label" }, button.name),
    button.kind === "rf" ? el("span", { class: "kind" }, "RF") : null,
  );
  let longPressed = false;
  let timer = null;
  key.addEventListener("pointerdown", () => {
    longPressed = false;
    timer = setTimeout(() => {
      longPressed = true;
      navigator.vibrate?.(15);
      openButton(remote.id, button.id);
    }, LONG_PRESS_MS);
  });
  for (const ev of ["pointerup", "pointerleave", "pointercancel"]) key.addEventListener(ev, () => clearTimeout(timer));
  key.addEventListener("contextmenu", (e) => e.preventDefault());
  key.addEventListener("click", () => {
    if (longPressed) return;
    if (editing) openButton(remote.id, button.id);
    else if (!button.kind) openRecord(remote.id, button.id);
    else press(remote, button, key);
  });
  return key;
}

function padFor(remote, editing) {
  const pad = el("div", { class: `pad${editing ? " editing" : ""}` });
  for (const b of remote.buttons) pad.append(keyFor(remote, b, editing));
  if (editing || !remote.buttons.length) {
    pad.append(el("button", { class: "key add", type: "button", onclick: () => addButton(remote.id) }, icon("add"), el("span", { class: "label" }, "Add button")));
  }
  return pad;
}

async function press(remote, button, key) {
  key.classList.remove("sent", "failed");
  navigator.vibrate?.(10);
  try {
    await api("/api/send", { button: button.id });
    key.classList.add("sent");
    setTimeout(() => key.classList.remove("sent"), 450);
    if (state.deviceState !== "online" && state.device?.configured) setDeviceState("online");
    if (remote.category === "light") trackLight(remote, button);
  } catch (err) {
    key.classList.add("failed");
    setTimeout(() => key.classList.remove("failed"), 1500);
    if (err.code === "device") setDeviceState("offline");
    toast(err.message);
  }
}

// IR lights don't report back, so remember what the last button meant.
const lightKey = (id) => `homeyhome.light.${id}`;
const lightState = (id) => storageGet(lightKey(id));

function trackLight(remote, button) {
  const name = button.name.toLowerCase();
  let next = null;
  if (/\boff\b/.test(name)) next = "off";
  else if (/\bon\b/.test(name) || /bright|warm|cool|night/.test(name)) next = "on";
  else if (button.icon === "power" || /power|toggle/.test(name)) next = lightState(remote.id) === "on" ? "off" : "on";
  if (!next) return;
  storageSet(lightKey(remote.id), next);
  renderPinned();
  renderRemoteList();
  renderLightGlow();
}

function renderLightGlow() {
  const anyOn = state.home?.remotes.some((r) => r.category === "light" && r.pinned && lightState(r.id) === "on");
  document.body.dataset.light = anyOn ? "on" : "off";
}

// --- climate -------------------------------------------------------------------

function startClimate() {
  stopClimate();
  state.climateTimer = setInterval(() => {
    if (document.visibilityState === "visible") refreshClimate();
  }, CLIMATE_EVERY_MS);
}
function stopClimate() {
  clearInterval(state.climateTimer);
  state.climateTimer = null;
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.user) refreshClimate();
});
$("temp-tile").addEventListener("click", () => refreshClimate(true));
$("hum-tile").addEventListener("click", () => refreshClimate(true));

let climateBusy = false;
async function refreshClimate(fresh = false) {
  if (climateBusy || !state.user) return;
  climateBusy = true;
  try {
    const data = await api(`/api/climate${fresh ? "?fresh=1" : ""}`);
    state.climate = data;
    if (data.online) setDeviceState("online");
    else setDeviceState("offline", "Can't reach the RM4");
    renderClimate();
  } catch (err) {
    if (err.code === "no_device") setDeviceState("none");
    else {
      setDeviceState("offline");
      if (fresh) toast(err.message);
    }
    renderClimate();
  } finally {
    climateBusy = false;
  }
}

function tempNote(t) {
  if (t < 16) return "Cold";
  if (t < 19) return "Cool";
  if (t <= 25) return "Comfortable";
  if (t <= 28) return "Warm";
  return "Hot";
}
function humNote(h) {
  if (h < 30) return "Dry";
  if (h <= 60) return "Comfortable";
  if (h <= 70) return "Humid";
  return "Very humid";
}

function renderClimate() {
  const c = state.climate;
  const has = c?.online && c.sensor && Number.isFinite(c.temperature);
  $("temp-value").textContent = has ? c.temperature.toFixed(1) : "--";
  $("hum-value").textContent = has ? Math.round(c.humidity) : "--";
  $("temp-note").textContent = has ? tempNote(c.temperature) : c?.online && c.sensor === false ? "No sensor" : "";
  $("hum-note").textContent = has ? humNote(c.humidity) : c?.online && c.sensor === false ? "Plug in the HTS2 cable" : "";
  renderHistory(c?.history ?? []);
}

function renderHistory(all) {
  const since = Date.now() - 24 * 3600_000;
  const pts = all.filter((p) => p.at >= since);
  const svg = $("spark");
  svg.replaceChildren();
  const hint = $("history-hint");
  if (pts.length < 2) {
    $("history-range").textContent = "Last 24 hours";
    hint.textContent = "The graph fills in while Homey Home is open: one reading every 5 minutes.";
    hint.hidden = false;
    svg.toggleAttribute("hidden", true);
    return;
  }
  hint.hidden = true;
  svg.toggleAttribute("hidden", false);
  const ts = pts.map((p) => p.t);
  const hs = pts.map((p) => p.h);
  const t0 = pts[0].at;
  const span = Math.max(pts.at(-1).at - t0, 1);
  const line = (vals) => {
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (hi - lo < 1) [lo, hi] = [lo - 0.5, hi + 0.5];
    // Split into segments at gaps longer than 20 minutes (the app was closed).
    let d = "";
    pts.forEach((p, i) => {
      const x = ((p.at - t0) / span) * 300;
      const y = 58 - ((vals[i] - lo) / (hi - lo)) * 52;
      const gap = i === 0 || p.at - pts[i - 1].at > 20 * 60_000;
      d += `${gap ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)} `;
    });
    return d;
  };
  const ns = "http://www.w3.org/2000/svg";
  for (const [cls, vals] of [["h", hs], ["t", ts]]) {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("class", cls);
    path.setAttribute("d", line(vals));
    svg.append(path);
  }
  const hours = Math.max(1, Math.round(span / 3600_000));
  $("history-range").textContent = `${hours} h · ${Math.min(...ts).toFixed(1)}–${Math.max(...ts).toFixed(1)} °C · ${Math.round(Math.min(...hs))}–${Math.round(Math.max(...hs))} %`;
}

// --- sheets: shared --------------------------------------------------------------

const SHEETS = ["remote-sheet", "button-sheet", "record-sheet", "add-sheet", "settings-sheet"];
function openSheet(id) {
  $(id).hidden = false;
}
function closeSheet(id) {
  $(id).hidden = true;
  if (id === "record-sheet") stopRecording();
  if (id === "remote-sheet") {
    state.remote = null;
    state.editing = false;
  }
}
function closeAllSheets() {
  for (const id of SHEETS) closeSheet(id);
}
for (const id of SHEETS) {
  $(id).addEventListener("click", (e) => {
    if (e.target === $(id)) closeSheet(id);
  });
}
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const top = [...SHEETS].reverse().find((id) => !$(id).hidden);
  if (top) closeSheet(top);
});

const findRemote = (id) => state.home?.remotes.find((r) => r.id === id);
const findButton = (remote, id) => remote?.buttons.find((b) => b.id === id);

async function homeAction(body) {
  const data = await api("/api/home", body);
  state.home = data.home;
  render();
  return data;
}

// --- remote sheet --------------------------------------------------------------

function openRemote(id, editing = false) {
  state.remote = id;
  state.editing = editing;
  renderRemoteSheet();
  openSheet("remote-sheet");
}

function renderRemoteSheet() {
  const remote = findRemote(state.remote);
  if (!remote) return closeSheet("remote-sheet");
  const c = cat(remote.category);
  $("remote-icon").replaceChildren(icon(c.icon));
  $("remote-icon").style.setProperty("--c", c.color);
  $("remote-title").textContent = remote.name;
  $("remote-edit").classList.toggle("on", state.editing);
  $("remote-edit").setAttribute("aria-pressed", String(state.editing));
  $("remote-hint").textContent = state.editing
    ? "Tap a button to rename, re-record, move or delete it."
    : learnedCount(remote) < remote.buttons.length
      ? "Dashed buttons aren't recorded yet: tap one to record it. Long-press any button to edit it."
      : "Long-press a button to edit it.";
  $("remote-pad").replaceWith(Object.assign(padFor(remote, state.editing), { id: "remote-pad" }));
  $("remote-settings").hidden = !state.editing;
  if (state.editing) {
    if (document.activeElement !== $("remote-name")) $("remote-name").value = remote.name;
    $("remote-pinned").checked = Boolean(remote.pinned);
    renderCats($("remote-cats"), remote.category, (key) => homeAction({ action: "remote_update", remote: remote.id, category: key }).catch((e) => toast(e.message)));
  }
}

function renderCats(host, selected, onPick) {
  host.replaceChildren();
  for (const [key, c] of Object.entries(CATEGORIES)) {
    host.append(
      el("button", { class: "cat-choice", type: "button", "aria-pressed": String(key === selected), style: { "--c": c.color }, onclick: () => onPick(key) }, icon(c.icon), c.label),
    );
  }
}

$("remote-close").addEventListener("click", () => closeSheet("remote-sheet"));
$("remote-edit").addEventListener("click", () => {
  state.editing = !state.editing;
  renderRemoteSheet();
});
$("remote-name").addEventListener("change", () => {
  homeAction({ action: "remote_update", remote: state.remote, name: $("remote-name").value }).catch((e) => toast(e.message));
});
$("remote-pinned").addEventListener("change", () => {
  homeAction({ action: "remote_update", remote: state.remote, pinned: $("remote-pinned").checked }).catch((e) => toast(e.message));
});
$("remote-up").addEventListener("click", () => homeAction({ action: "remote_move", remote: state.remote, dir: "up" }).catch((e) => toast(e.message)));
$("remote-down").addEventListener("click", () => homeAction({ action: "remote_move", remote: state.remote, dir: "down" }).catch((e) => toast(e.message)));
$("remote-delete").addEventListener("click", async () => {
  const remote = findRemote(state.remote);
  if (!remote || !confirm(`Delete “${remote.name}” and its ${remote.buttons.length} buttons? Recorded codes are lost.`)) return;
  try {
    await homeAction({ action: "remote_delete", remote: remote.id });
    closeSheet("remote-sheet");
  } catch (e) {
    toast(e.message);
  }
});

async function addButton(remoteId) {
  try {
    const data = await homeAction({ action: "button_add", remote: remoteId, name: "New button", icon: "none" });
    openButton(remoteId, data.button);
  } catch (e) {
    toast(e.message);
  }
}

// --- button sheet --------------------------------------------------------------

function openButton(remoteId, buttonId) {
  state.button = { remote: remoteId, button: buttonId };
  renderButtonSheet(true);
  openSheet("button-sheet");
}

function renderButtonSheet(fillName = false) {
  const remote = findRemote(state.button?.remote);
  const button = findButton(remote, state.button?.button);
  if (!button) return closeSheet("button-sheet");
  $("button-title").textContent = `${remote.name} · ${button.name}`;
  if (fillName) $("button-name").value = button.name;
  const status = $("button-status");
  status.replaceChildren(
    button.kind
      ? el("span", {}, el("strong", {}, button.kind === "rf" ? "RF code recorded" : "IR code recorded"), " · tap Record to replace it")
      : el("span", {}, el("strong", {}, "Nothing recorded yet"), " · tap Record and press the button on your remote"),
  );
  status.className = `info-box ${button.kind ? "ok" : ""}`;
  $("button-test").disabled = !button.kind;
  $("button-copy").disabled = !button.kind;
  const grid = $("button-icons");
  grid.replaceChildren();
  for (const name of ICON_ORDER) {
    grid.append(
      el(
        "button",
        {
          class: "icon-choice",
          type: "button",
          "aria-label": name === "none" ? "No icon, show the name" : name,
          "aria-pressed": String((button.icon || "none") === name),
          onclick: () => homeAction({ action: "button_update", ...state.button, icon: name }).then(() => renderButtonSheet()).catch((e) => toast(e.message)),
        },
        name === "none" ? el("span", { class: "none" }, "Aa") : icon(name),
      ),
    );
  }
}

$("button-close").addEventListener("click", () => closeSheet("button-sheet"));
$("button-name").addEventListener("change", () => {
  homeAction({ action: "button_update", ...state.button, name: $("button-name").value }).then(() => renderButtonSheet()).catch((e) => toast(e.message));
});
$("button-record").addEventListener("click", () => openRecord(state.button.remote, state.button.button));
$("button-test").addEventListener("click", async () => {
  try {
    await api("/api/send", { button: state.button.button });
    toast("Sent.", "info");
  } catch (e) {
    toast(e.message);
  }
});
$("button-copy").addEventListener("click", async () => {
  try {
    const { code } = await api("/api/home", { action: "button_export", ...state.button });
    await navigator.clipboard.writeText(code);
    toast("Code copied (Broadlink base64).", "info");
  } catch (e) {
    toast(e.message || "Couldn't copy.");
  }
});
$("button-left").addEventListener("click", () => homeAction({ action: "button_move", ...state.button, dir: "left" }).catch((e) => toast(e.message)));
$("button-right").addEventListener("click", () => homeAction({ action: "button_move", ...state.button, dir: "right" }).catch((e) => toast(e.message)));
$("button-delete").addEventListener("click", async () => {
  const button = findButton(findRemote(state.button.remote), state.button.button);
  if (!button || !confirm(`Delete “${button.name}”?`)) return;
  try {
    await homeAction({ action: "button_delete", ...state.button });
    closeSheet("button-sheet");
  } catch (e) {
    toast(e.message);
  }
});

// --- recording -----------------------------------------------------------------

const rec = { remote: null, button: null, mode: "ir", run: 0, code: null, kind: null, rfActive: false };

function openRecord(remoteId, buttonId) {
  const remote = findRemote(remoteId);
  const button = findButton(remote, buttonId);
  if (!button) return;
  if (!state.device?.configured) {
    toast("Set up your RM4 Pro in Settings first.");
    return openSettings();
  }
  Object.assign(rec, { remote: remoteId, button: buttonId, code: null, kind: null });
  $("record-title").textContent = `Record “${button.name}”`;
  setMode(button.kind === "rf" ? "rf" : rec.mode === "paste" ? "ir" : rec.mode);
  openSheet("record-sheet");
}

function setMode(mode) {
  stopRecording();
  rec.mode = mode;
  rec.code = null;
  for (const b of $("record-sheet").querySelectorAll(".seg button")) b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
  $("paste-box").hidden = mode !== "paste";
  $("rec-stage").hidden = mode === "paste";
  $("rec-start").hidden = mode === "paste";
  $("rec-done").hidden = mode !== "paste";
  $("rec-again").hidden = true;
  $("rec-error").textContent = "";
  if (mode === "paste") {
    $("paste-code").value = "";
    return;
  }
  stage("idle", "wave", "Ready", mode === "ir"
    ? "Tap Start, then point your remote at the RM4 Pro from close by and press the button once."
    : "For 433/315 MHz remotes. Tap Start, then hold the remote's button down near the RM4 Pro until it finds the frequency.");
  $("rec-start").textContent = "Start recording";
}
for (const b of $("record-sheet").querySelectorAll(".seg button")) b.addEventListener("click", () => setMode(b.dataset.mode));

function stage(s, iconName, title, text, count = "") {
  $("rec-stage").dataset.state = s;
  $("rec-core").replaceChildren(icon(iconName));
  $("rec-title").textContent = title;
  $("rec-text").textContent = text;
  $("rec-count").textContent = count;
}

function stopRecording() {
  rec.run++;
  if (rec.rfActive) {
    rec.rfActive = false;
    api("/api/learn", { action: "cancel" }).catch(() => {});
  }
}

/** Polls `fn` until it returns something truthy, the window closes, or the run is cancelled. */
async function pollUntil(run, windowMs, fn, onTick) {
  const end = Date.now() + windowMs;
  let errors = 0;
  while (Date.now() < end) {
    onTick?.(Math.ceil((end - Date.now()) / 1000));
    await sleep(LEARN_POLL_MS);
    if (run !== rec.run) return null;
    try {
      const out = await fn();
      errors = 0;
      if (out) return out;
    } catch (err) {
      if (++errors >= 3) throw err;
    }
  }
  return null;
}

/** The learned code with its kind and size, or null while there's nothing yet. */
async function checkLearned() {
  const r = await api("/api/learn", { action: "check" });
  return r.code ? r : null;
}

async function startRecording() {
  stopRecording();
  const run = rec.run;
  $("rec-error").textContent = "";
  $("rec-start").hidden = true;
  $("rec-done").hidden = true;
  $("rec-again").hidden = true;
  rec.code = null;
  const live = () => run === rec.run;
  try {
    let result = null;
    if (rec.mode === "ir") {
      stage("listen", "rec", "Starting…", "Waking up the RM4 Pro.");
      await api("/api/learn", { action: "ir" });
      if (!live()) return;
      result = await pollUntil(run, IR_WINDOW_MS, checkLearned, (left) =>
        stage("listen", "rec", "Listening…", "Point your remote at the RM4 Pro and press the button once.", `${left} s`),
      );
    } else {
      stage("listen", "wave", "Starting…", "Waking up the RM4 Pro.");
      rec.rfActive = true;
      await api("/api/learn", { action: "rf_sweep" });
      if (!live()) return;
      const freq = await pollUntil(run, RF_SWEEP_WINDOW_MS, async () => {
        const r = await api("/api/learn", { action: "rf_freq" });
        return r.found ? r : null;
      }, (left) => stage("listen", "wave", "Hold the button down…", "Keep holding your remote's button near the RM4 Pro while it finds the frequency.", `${left} s`));
      if (!live()) return;
      if (!freq) throw new Error("Couldn't find a radio frequency. Hold the button closer and longer, or try Infrared.");
      await api("/api/learn", { action: "rf_find", frequency: freq.frequency });
      if (!live()) return;
      result = await pollUntil(run, RF_PRESS_WINDOW_MS, checkLearned, (left) =>
        stage("listen", "wave", `Found ${freq.frequency.toFixed(2)} MHz`, "Let go, then press the button once more, briefly.", `${left} s`),
      );
      rec.rfActive = false;
      api("/api/learn", { action: "cancel" }).catch(() => {});
    }
    if (!live()) return;
    if (!result) {
      stage("fail", "wave", "Nothing heard", rec.mode === "ir" ? "Get closer (a hand's length away) and make sure the remote is infrared, not radio." : "Try again, pressing the button briefly once.");
      $("rec-start").hidden = false;
      $("rec-start").textContent = "Try again";
      return;
    }
    rec.code = result.code;
    rec.kind = result.kind;
    stage("done", "check", "Got it", `${result.kind === "rf" ? "RF" : "IR"} code, ${result.bytes} bytes. Test it, then save.`);
    $("rec-done").hidden = false;
    $("rec-again").hidden = false;
  } catch (err) {
    if (!live()) return;
    rec.rfActive = false;
    stage("fail", "wave", "Recording stopped", "");
    $("rec-error").textContent = err.message;
    $("rec-start").hidden = false;
    $("rec-start").textContent = "Try again";
  }
}

$("rec-start").addEventListener("click", startRecording);
$("rec-again").addEventListener("click", () => setMode(rec.mode));
$("record-close").addEventListener("click", () => closeSheet("record-sheet"));

const currentCode = () => (rec.mode === "paste" ? $("paste-code").value.trim() : rec.code);

$("rec-test").addEventListener("click", async () => {
  const code = currentCode();
  if (!code) return ($("rec-error").textContent = "Paste a code first.");
  try {
    await api("/api/send", { code });
    toast("Sent. Did it work?", "info");
  } catch (e) {
    $("rec-error").textContent = e.message;
  }
});

$("rec-save").addEventListener("click", async () => {
  const code = currentCode();
  if (!code) return ($("rec-error").textContent = "Paste a code first.");
  try {
    await homeAction({ action: "button_code", remote: rec.remote, button: rec.button, code });
    closeSheet("record-sheet");
    if (!$("button-sheet").hidden) renderButtonSheet();
    toast("Saved.", "info");
  } catch (e) {
    $("rec-error").textContent = e.message;
  }
});

// --- add remote ----------------------------------------------------------------

let addCategory = "tv";
function openAdd() {
  addCategory = "tv";
  $("add-name").value = "";
  $("add-blank").checked = false;
  $("add-error").textContent = "";
  renderAddCats();
  openSheet("add-sheet");
}
function renderAddCats() {
  renderCats($("add-cats"), addCategory, (key) => {
    addCategory = key;
    $("add-name").placeholder = CATEGORIES[key].label;
    renderAddCats();
  });
}
$("add-cancel").addEventListener("click", () => closeSheet("add-sheet"));
$("add-create").addEventListener("click", async () => {
  try {
    const data = await homeAction({ action: "remote_add", category: addCategory, name: $("add-name").value, blank: $("add-blank").checked, pinned: addCategory === "light" });
    closeSheet("add-sheet");
    openRemote(data.remote, $("add-blank").checked);
  } catch (e) {
    $("add-error").textContent = e.message;
  }
});

// --- settings ------------------------------------------------------------------

function openSettings() {
  $("dev-host").value = state.device?.host ?? "";
  $("dev-port").value = state.device?.port ?? 80;
  $("room-input").value = state.home?.room ?? "";
  $("me-name").textContent = state.user?.name ?? "";
  $("dev-error").textContent = "";
  renderDeviceInfo();
  openSheet("settings-sheet");
}

function ago(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

function renderDeviceInfo() {
  const d = state.device;
  const box = $("dev-info");
  if (!d?.configured || !d.mac) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.className = `info-box ${d.locked ? "bad" : "ok"}`;
  box.replaceChildren(
    el("strong", {}, d.name || d.model || "Broadlink device"),
    el("span", {}, `${d.model ?? "Unknown model"} · MAC ${d.mac}`),
    el("span", {}, d.locked ? "Locked: turn off Lock device in the Broadlink app." : `Connected ${d.checked ? ago(d.checked) : ""}`),
  );
}

async function deviceAction(body, button) {
  $("dev-error").textContent = "";
  const label = button.textContent;
  button.disabled = true;
  button.replaceChildren(el("span", { class: "spinner" }));
  try {
    const data = await api("/api/device", body);
    state.device = data.device;
    renderDeviceInfo();
    setDeviceState("online");
    refreshClimate(true);
    toast("The RM4 Pro answered.", "info");
  } catch (e) {
    $("dev-error").textContent = e.message;
    if (body.action === "save") {
      state.device = { ...state.device, configured: true, host: body.host, port: body.port, mac: null };
      renderDeviceInfo();
    }
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

$("open-settings").addEventListener("click", openSettings);
$("setup-open").addEventListener("click", openSettings);
$("settings-close").addEventListener("click", () => closeSheet("settings-sheet"));
$("dev-save").addEventListener("click", (e) =>
  deviceAction({ action: "save", host: $("dev-host").value.trim(), port: $("dev-port").value.trim() || 80 }, e.currentTarget),
);
$("dev-test").addEventListener("click", (e) => deviceAction({ action: "test" }, e.currentTarget));
$("room-save").addEventListener("click", async () => {
  try {
    await homeAction({ action: "room_rename", name: $("room-input").value });
    toast("Saved.", "info");
  } catch (e) {
    toast(e.message);
  }
});

// --- start ---------------------------------------------------------------------

fillIcons();
loadSession();

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
