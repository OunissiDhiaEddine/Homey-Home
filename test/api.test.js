import test from "node:test";
import assert from "node:assert/strict";
import { startMemoryRedis } from "../scripts/mem-redis.js";
import { startFakeRm4 } from "../scripts/fake-rm4.js";
import { hashPassword } from "../lib/secrets.js";

const db = await startMemoryRedis();
const fake = await startFakeRm4({ port: 0, log: () => {}, learnDelayMs: 100 });
const env = { KV_REST_API_URL: db.url, KV_REST_API_TOKEN: db.token, HOME_USERS: "sara", DATA_KEY: "k".repeat(44) };
Object.assign(process.env, env);

const routes = {
  session: await import("../api/session.js"),
  home: await import("../api/home.js"),
  device: await import("../api/device.js"),
  climate: await import("../api/climate.js"),
  learn: await import("../api/learn.js"),
  send: await import("../api/send.js"),
  tokens: await import("../api/tokens.js"),
  shortcut: await import("../api/shortcut.js"),
};

const ORIGIN = "https://homey-home.test";

async function call(name, body, cookie = "", { query = "", origin = ORIGIN } = {}) {
  const headers = { cookie, host: "homey-home.test" };
  if (body !== undefined) Object.assign(headers, { "content-type": "application/json", origin });
  const req = new Request(`${ORIGIN}/api/${name}${query}`, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await routes[name][body === undefined ? "GET" : "POST"](req);
  const data = await res.json();
  const set = res.headers.get("set-cookie");
  return { status: res.status, data, cookie: set ? set.split(";")[0] : cookie };
}

async function addUser(uid, name, role, password) {
  db.db.run(["SET", `uname:${name.toLowerCase()}`, uid]);
  db.db.run(["HSET", `u:${uid}`, "name", name, "role", role, "pw", await hashPassword(password)]);
}

await addUser("adminuid0000000000000A", "Dhia", "admin", "adminpassword");
await addUser("sarauid00000000000000A", "sara", "user", "sarapassword1");
await addUser("frienduid0000000000000", "friend", "user", "friendpassword");
// A HomeyDeck session, which must not let anyone into Homey Home by itself.
db.db.run(["SET", "sess:x", "adminuid0000000000000A"]);

test.after(() => {
  db.close();
  fake.close();
});

let admin;

test("one sign-in for both pages; only the admin and HOME_USERS get the room controls", async () => {
  assert.equal((await call("home")).status, 401);
  assert.equal((await call("session", { action: "login", username: "dhia", password: "wrong-password" })).status, 401);

  // Any HomeyDeck account signs in (for its PCs), but the room is off limits.
  const friend = await call("session", { action: "login", username: "friend", password: "friendpassword" });
  assert.equal(friend.status, 200);
  assert.equal((await call("session", undefined, friend.cookie)).data.homeAccess, false);
  const refused = await call("home", undefined, friend.cookie);
  assert.equal(refused.status, 403);
  assert.equal(refused.data.code, "no_access");

  const sara = await call("session", { action: "login", username: "SARA", password: "sarapassword1" });
  assert.equal(sara.status, 200);
  assert.equal((await call("home", undefined, sara.cookie)).status, 200);

  const login = await call("session", { action: "login", username: "dhia", password: "adminpassword" });
  assert.equal(login.status, 200);
  assert.match(login.cookie, /^hd_session=/);
  admin = login.cookie;
  assert.equal(db.db.run(["SMEMBERS", "sessions:adminuid0000000000000A"]).result.length, 1);
  assert.equal((await call("session", undefined, admin)).data.homeAccess, true);

  const me = await call("home", undefined, admin);
  assert.equal(me.status, 200);
  assert.equal(me.data.user.name, "Dhia");
  assert.equal(me.data.home.room, "My Room");
  assert.equal(me.data.home.remotes[0].category, "light");
  assert.equal(me.data.device.configured, false);
});

test("refuses cross-site posts", async () => {
  const r = await call("home", { action: "room_rename", name: "x" }, admin, { origin: "https://evil.example" });
  assert.equal(r.status, 403);
});

test("sets up the device and reads the climate", async () => {
  const noDevice = await call("climate", undefined, admin);
  assert.equal(noDevice.status, 409);
  assert.equal(noDevice.data.code, "no_device");

  const bad = await call("device", { action: "save", host: "not a host!", port: 80 }, admin);
  assert.equal(bad.status, 400);

  const saved = await call("device", { action: "save", host: "127.0.0.1", port: fake.port }, admin);
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.device.model, "RM4 pro");
  assert.equal(saved.data.device.mac, "E8:70:72:0A:1B:2C");

  const c = await call("climate", undefined, admin);
  assert.equal(c.status, 200);
  assert.equal(c.data.online, true);
  assert.equal(c.data.sensor, true);
  assert.ok(c.data.temperature > 20);
  assert.equal(c.data.history.length, 1);
  const cached = await call("climate", undefined, admin);
  assert.equal(cached.data.cached, true);
});

test("re-authenticates when the device forgot the session", async () => {
  fake.sessions.clear();
  const c = await call("climate", undefined, admin, { query: "?fresh=1" });
  assert.equal(c.data.online, true, JSON.stringify(c.data));
});

test("records a button, sends it, and edits the remote", async () => {
  const me = await call("home", undefined, admin);
  const light = me.data.home.remotes[0];
  const on = light.buttons[0];

  assert.equal((await call("send", { button: on.id }, admin)).data.code, "no_code");

  assert.equal((await call("learn", { action: "ir" }, admin)).status, 200);
  let code = null;
  for (let i = 0; i < 20 && !code; i++) {
    await new Promise((r) => setTimeout(r, 50));
    code = (await call("learn", { action: "check" }, admin)).data.code;
  }
  assert.ok(code, "learned a code");

  const saved = await call("home", { action: "button_code", remote: light.id, button: on.id, code }, admin);
  assert.equal(saved.data.home.remotes[0].buttons[0].kind, "ir");

  const sent = await call("send", { button: on.id }, admin);
  assert.equal(sent.status, 200, JSON.stringify(sent.data));
  assert.equal(fake.state.sent.at(-1).toString("base64"), code);

  const tv = await call("home", { action: "remote_add", category: "tv", name: "Living TV" }, admin);
  const tvRemote = tv.data.home.remotes.find((r) => r.id === tv.data.remote);
  assert.equal(tvRemote.buttons[0].name, "Power");
  const added = await call("home", { action: "button_add", remote: tvRemote.id, name: "Netflix", icon: "play" }, admin);
  assert.ok(added.data.button);
  const moved = await call("home", { action: "button_move", remote: tvRemote.id, button: added.data.button, dir: "left" }, admin);
  const names = moved.data.home.remotes.find((r) => r.id === tvRemote.id).buttons.map((b) => b.name);
  assert.equal(names.at(-2), "Netflix");
  const gone = await call("home", { action: "remote_delete", remote: tvRemote.id }, admin);
  assert.equal(gone.data.home.remotes.length, 1);

  const exported = await call("home", { action: "button_export", remote: light.id, button: on.id }, admin);
  assert.equal(exported.data.code, code);
});

test("learns RF in two steps", async () => {
  await call("learn", { action: "rf_sweep" }, admin);
  let f = { found: false };
  for (let i = 0; i < 20 && !f.found; i++) {
    await new Promise((r) => setTimeout(r, 30));
    f = (await call("learn", { action: "rf_freq" }, admin)).data;
  }
  assert.equal(f.frequency, 433.92);
  await call("learn", { action: "rf_find", frequency: f.frequency }, admin);
  let res = { code: null };
  for (let i = 0; i < 20 && !res.code; i++) {
    await new Promise((r) => setTimeout(r, 30));
    res = (await call("learn", { action: "check" }, admin)).data;
  }
  assert.equal(res.kind, "rf");
  await call("learn", { action: "cancel" }, admin);
});

async function siri(token, body, { form = false } = {}) {
  const headers = { authorization: `Bearer ${token}` };
  let payload;
  if (form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    payload = new URLSearchParams(body).toString();
  } else {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await routes.shortcut.POST(new Request(`${ORIGIN}/api/shortcut`, { method: "POST", headers, body: payload }));
  return { status: res.status, text: (await res.text()).trim() };
}

test("Siri & Shortcuts: tokens, presses by name, scenes, climate", async () => {
  assert.equal((await siri("nonsense", { press: "On" })).status, 401);

  const made = await call("tokens", { action: "create", name: "iPhone" }, admin);
  assert.equal(made.status, 200);
  const token = made.data.token;
  assert.equal(made.data.tokens.length, 1);
  assert.ok(!JSON.stringify(made.data.tokens).includes(token.split(".")[1]), "the secret isn't listed");

  const home = (await call("home", undefined, admin)).data.home;
  const light = home.remotes[0];

  // Record "Off" so the light can be switched both ways.
  const off = light.buttons.find((b) => b.name === "Off");
  const on = light.buttons.find((b) => b.name === "On");
  const onCode = (await call("home", { action: "button_export", remote: light.id, button: on.id }, admin)).data.code;
  await call("home", { action: "button_code", remote: light.id, button: off.id, code: onCode }, admin);

  let r = await siri(token, { press: "room light / off" });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.text, "Room light is off.");
  r = await siri(token, { press: "On" }); // the remote can be left out
  assert.equal(r.text, "Room light is on.");
  assert.equal((await call("home", undefined, admin)).data.lights[light.id], "on", "the app sees what Siri did");

  r = await siri(token, { press: ["Room light / Off", "Room light / On"] });
  assert.equal(r.text, "Done: Room light Off, then Room light On.");

  r = await siri(token, { press: "Room light / Brighter" });
  assert.equal(r.status, 404);
  assert.match(r.text, /Nothing is recorded/);

  r = await siri(token, { press: "Kitchen / On" });
  assert.equal(r.status, 404);
  assert.match(r.text, /no remote called “Kitchen”/);

  r = await siri(token, { press: "Room light / On" }, { form: true });
  assert.equal(r.text, "Room light is on.");

  r = await siri(token, { get: "climate" });
  assert.match(r.text, /^My Room is \d+\.\d °C with \d+ % humidity\.$/);

  const listed = await call("tokens", { action: "list" }, admin);
  assert.ok(listed.data.tokens[0].lastUsed);

  await call("tokens", { action: "revoke", id: listed.data.tokens[0].id }, admin);
  assert.equal((await siri(token, { press: "On" })).status, 401);
});

test("signing out ends the session", async () => {
  await call("session", { action: "logout" }, admin);
  assert.equal((await call("home", undefined, admin)).status, 401);
  assert.equal((await call("session", undefined, admin)).status, 401);
});
