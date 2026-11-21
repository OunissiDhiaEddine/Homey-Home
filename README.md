# Homey Home

A tiny Home Assistant for one room, running only on Vercel, with **HomeyDeck** built in at `/deck`. There's no VPS and nothing to install at home: a PWA plus a few serverless functions that talk to your **Broadlink RM4 Pro** over the internet.

- **Dashboard:** your room's temperature and humidity (from the RM4 Pro's HTS2 sensor cable), with a 24-hour graph.
- **Room light:** a card on the dashboard with buttons you set up yourself (On, Off, Brighter, Dimmer, or anything else).
- **Record anything:** remotes by type (TV, AC, light, fan, speaker, projector, TV box, other), each starting with the usual buttons. Record them from your real remote (infrared, or 433/315 MHz radio), or paste Broadlink codes from Home Assistant/SmartIR.
- **HomeyDeck included:** the HomeyDeck app (wake and control your gaming PC) is the `/deck` page, with one sign-in for both. Its API, agents and Steam Deck plugin work exactly as before.
- **Siri & Shortcuts:** "Hey Siri, light on", scenes, and "what's the temperature".

```
phone (PWA) ──HTTPS──▶ Vercel function ──UDP over the internet──▶ your router (DDNS) ──port forward──▶ RM4 Pro :80
                          │
                          └──▶ Upstash Redis (accounts, sessions, PCs, your remotes and codes)
PC agent / Steam Deck ──HTTPS──▶ /api/agent/*, /api/session, /api/status, /api/command (HomeyDeck's API)
```

The RM4 speaks Broadlink's local protocol: AES-encrypted UDP packets on port 80. `lib/broadlink.js` implements it with Node's built-in `dgram` and `crypto`, the same packets as [python-broadlink](https://github.com/mjg59/python-broadlink), the library Home Assistant uses. HomeyDeck's Wake-on-LAN already sends UDP from Vercel the same way.

## Setup

### 1. Your router and the RM4

1. **Give the RM4 Pro a fixed local IP:** a DHCP reservation in your router, for example `192.168.1.50`.
2. **Forward a UDP port to it:** *external* UDP port → `192.168.1.50`, *internal* port **80**, protocol **UDP**. The RM4 doesn't use TCP, so a TCP forward does nothing.
   - The external port doesn't have to be 80. Many ISPs block inbound port 80, and a less common port like `18080` gets far less scanning. Whatever you pick goes in Homey Home's settings.
3. **Unlock the RM4** in the Broadlink app: open the device → ⋯ → Properties → turn **Lock device** off. A locked RM4 refuses other apps.
4. For temperature and humidity, the **HTS2 sensor cable** must be plugged into the RM4 Pro. Without it, the dashboard says "No sensor" and everything else still works.

Your DDNS name must point at your home's public IP. If HomeyDeck's Wake-on-LAN works, it already does.

### 2. Deploy

1. Push this folder to a new GitHub repository.
2. In Vercel: **Add New… → Project → Import** that repo. Framework preset: **Other**. Leave the build settings empty, then **Deploy**.
3. **Connect the database:** in the project open **Storage**, pick your Upstash Redis database (the one HomeyDeck used), and **Connect Project**. Accounts, sessions and PCs live there. Homey Home's own keys all start with `hh:`.
4. **Function region:** in **Settings → Functions**, choose the same region as HomeyDeck (next to the database).
5. **Redeploy** so the database settings take effect.

Optional environment variables:

| Name | What it does |
|---|---|
| `HOME_USERS` | Usernames besides the HomeyDeck admin that may use Homey Home, comma separated (e.g. `sara,omar`). Other HomeyDeck users are refused, so friends you invited to HomeyDeck can't touch your lights. |
| `DATA_KEY` | **Required for the HomeyDeck page.** The same value HomeyDeck had: it decrypts the PCs' wake details and signs dual-boot agents. A different key means re-entering wake details and re-pairing second systems. |
| `ADMIN_USERNAME` | The HomeyDeck admin's username, as HomeyDeck had it. |
| `MAX_PCS_PER_USER`, `AGENT_DOWNLOAD_URL`, `AGENT_LINUX_DOWNLOAD_URL` | HomeyDeck's optional settings, unchanged. |
| `BROADLINK_HOST` / `BROADLINK_PORT` | A default RM4 address, if you'd rather not set it in the app. |

### 3. First run

1. Open the site and sign in with your HomeyDeck admin username and password.
2. Tap **Set up** (or the gear): Address = your DDNS name, UDP port = your external port → **Save & test**. You should see *RM4 pro · MAC …*.
3. On the **Room light** card, tap a dashed button (On, Off, …). Point the light's remote at the RM4 Pro, press the button, then **Test it** and **Save**.
4. Add more remotes with **Add remote**. Long-press any button, or tap ✎, to rename it, change its icon, record it again, move it, copy its code or delete it.
5. Install it: Safari → Share → **Add to Home Screen** (or Chrome → Install app).

**Radio (RF) remotes** (433/315 MHz) take two steps: hold the remote's button down while the RM4 finds the frequency, then let go and press it once more.

## Siri & Shortcuts

Trigger any button, a whole scene, or ask for the temperature with Siri, using Apple's **Shortcuts** app. No extra app needed.

**1. Make a token:** Homey Home → Settings → **Siri & Shortcuts** → **Make token**, then **Copy**. That copies `Bearer …`, ready for the header. It's shown only once. Revoke it there anytime.

**2. Build the Shortcut** on your iPhone: Shortcuts → **+** → **Add Action** → **Get Contents of URL**, and tap **Show More**:

| Setting | Value |
|---|---|
| URL | `https://homey-home.vercel.app/api/shortcut` |
| Method | `POST` |
| Headers | `Authorization` = the copied `Bearer …` value |
| Request Body | **JSON**, one field (see below) |

**3. Name the Shortcut** what you'll say: *"Light on"* → "Hey Siri, light on".

What to put in the body:

| Do this | Field | Value |
|---|---|---|
| Press one button | `press` (Text) | `Room light / On` |
| Press several in order (a scene) | `press` (Array) | `Room light / Off`, `AC / Power`, `TV / Power` |
| Press it a few times | add `repeat` (Number) | `3` |
| Hear the temperature | `get` (Text) | `climate`, then add a **Speak Text** action after it |

Names are `Remote / Button` as shown in the app, in any case. Every button's editor has **Copy name for Siri & Shortcuts**. You can leave the remote out when only one remote has a button with that name. Homey Home answers in one plain sentence ("Room light is on.", "My Room is 23.4 °C with 48 % humidity.", or what went wrong), so add **Show Result** or **Speak Text** if you want to hear it. Light changes made by Siri show up in the app.

Ideas: put a scene on the Home Screen, or run one from **Automation** (e.g. "When I arrive home" → AC on, or "At 23:30" → Room light off).

## HomeyDeck and the login

The HomeyDeck web app is copied in unchanged apart from paths: its page lives in `public/deck/` (served at `/deck/`), and its API keeps its original routes (`/api/session`, `/api/pcs`, `/api/status`, `/api/command`, `/api/account`, `/api/admin`, `/api/health`, `/api/agent/*`), so paired agents and the Steam Deck plugin don't notice the move. Its source of truth is still the [HomeyDeck repo](https://github.com/OunissiDhiaEddine/HomeyDeck) (agent, Decky plugin, releases).

There's one sign-in, HomeyDeck's (`POST /api/session`, cookie `hd_session`), for both pages. Every account can use the HomeyDeck page for its own PCs. Homey Home's room controls are only for the admin and `HOME_USERS`; anyone else who opens `/` is sent to `/deck/`. Invites, password changes, "sign out everywhere" and the admin page are on the HomeyDeck page (gear menu).

If `homeydeck.vercel.app` is pointed at this project, its `/` redirects to `/deck/` (see `vercel.json`), so old bookmarks and installed HomeyDeck apps keep working.

## Things to know

- **The open UDP port has no password.** Broadlink's local protocol has no real authentication, so anyone who finds the forwarded port can send IR/RF codes through your RM4. The risk is small (worst case, someone toggles your TV or light), but it's real. A non-standard external port helps. Close the forward if you stop using this.
- **History only fills in while the app is open.** Every time the dashboard reads the sensor (once a minute while open), it logs a point at most every 5 minutes. Always-on logging needs a scheduler, and Vercel Hobby cron runs only once a day.
- **Each action is one internet round trip to your house**, usually a fraction of a second. The device session key is cached in Redis for 20 minutes, so most taps skip the auth handshake. If the RM4 rebooted, Homey Home authenticates again automatically.
- **Upstash usage** is small: about 2–4 commands per tap or reading.

## Developing

Zero dependencies, Node 20+.

```bash
npm run dev:fake      # http://localhost:3000, in-memory database, user dev / devpassword,
                      # plus a pretend RM4 Pro on UDP 127.0.0.1:8780 (use that in Settings)
npm test              # protocol tests against the fake RM4 + API tests; HomeyDeck's tests
                      # need a real Redis (REDIS_URL or redis-server) and are skipped without one.
                      # CI (.github/workflows/ci.yml) runs everything with Redis on every push.
```

`npm run dev` without `:fake` uses your real RM4 if you set its address in Settings. Set `KV_REST_API_URL` / `KV_REST_API_TOKEN` to use a real database instead of the in-memory one.

```
api/        home.js: all of Homey Home's routes in one function (vercel.json rewrites
            /api/device, climate, learn, send, tokens, shortcut to it; Hobby allows 12 functions)
            HomeyDeck: session, account, admin, pcs, status, command, health, agent/*
lib/        Homey Home: broadlink.js (the UDP protocol), auth.js, access.js, home.js, device.js, shortcuts.js (Siri)
            HomeyDeck: accounts.js, pcs.js, wol.js; shared: redis.js, http.js, secrets.js
public/     Homey Home's PWA; public/deck/ is HomeyDeck's page
scripts/    dev server, in-memory Redis, fake RM4 Pro
test/       node --test
```
