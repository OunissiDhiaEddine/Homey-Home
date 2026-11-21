# Homey Home

A tiny Home Assistant for one room, running only on Vercel. There's no VPS and nothing to install at home: a PWA plus a few serverless functions that talk to your **Broadlink RM4 Pro** over the internet.

- **Dashboard:** your room's temperature and humidity (from the RM4 Pro's HTS2 sensor cable), with a 24-hour graph.
- **Room light:** a card on the dashboard with buttons you set up yourself (On, Off, Brighter, Dimmer, or anything else).
- **Record anything:** remotes by type (TV, AC, light, fan, speaker, projector, TV box, other), each starting with the usual buttons. Record them from your real remote (infrared, or 433/315 MHz radio), or paste Broadlink codes from Home Assistant/SmartIR.
- **Same login as HomeyDeck**, plus a button that jumps to HomeyDeck.

```
phone (PWA) ──HTTPS──▶ Vercel function ──UDP over the internet──▶ your router (DDNS) ──port forward──▶ RM4 Pro :80
                          │
                          └──▶ Upstash Redis (shared with HomeyDeck: accounts, sessions, your remotes and codes)
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
3. **Share HomeyDeck's database:** in the new project open **Storage**, pick the Upstash Redis database HomeyDeck already uses, and **Connect Project**. That's what makes your HomeyDeck login work here. Homey Home's own keys all start with `hh:`, so the two apps don't collide.
4. **Function region:** in **Settings → Functions**, choose the same region as HomeyDeck (next to the database).
5. **Redeploy** so the database settings take effect.

Optional environment variables:

| Name | What it does |
|---|---|
| `HOME_USERS` | Usernames besides the HomeyDeck admin that may use Homey Home, comma separated (e.g. `sara,omar`). Other HomeyDeck users are refused, so friends you invited to HomeyDeck can't touch your lights. |
| `HOMEYDECK_URL` | Where the HomeyDeck button goes. Defaults to `https://homeydeck.vercel.app`. |
| `BROADLINK_HOST` / `BROADLINK_PORT` | A default RM4 address, if you'd rather not set it in the app. |

### 3. First run

1. Open the site and sign in with your HomeyDeck admin username and password.
2. Tap **Set up** (or the gear): Address = your DDNS name, UDP port = your external port → **Save & test**. You should see *RM4 pro · MAC …*.
3. On the **Room light** card, tap a dashed button (On, Off, …). Point the light's remote at the RM4 Pro, press the button, then **Test it** and **Save**.
4. Add more remotes with **Add remote**. Long-press any button, or tap ✎, to rename it, change its icon, record it again, move it, copy its code or delete it.
5. Install it: Safari → Share → **Add to Home Screen** (or Chrome → Install app).

**Radio (RF) remotes** (433/315 MHz) take two steps: hold the remote's button down while the RM4 finds the frequency, then let go and press it once more.

## How the login works

Homey Home reads HomeyDeck's accounts (`uname:*`, `u:*`) from the shared Redis and creates its own sessions (`sess:*`, cookie `hh_session`). Each session is added to HomeyDeck's `sessions:{uid}` list, so in HomeyDeck **Sign out everywhere**, a password change, or disabling the account also signs you out of Homey Home. Accounts and passwords are managed in HomeyDeck only. Homey Home never creates or changes them.

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
npm test              # protocol tests against the fake RM4 + API tests
```

`npm run dev` without `:fake` uses your real RM4 if you set its address in Settings. Set `KV_REST_API_URL` / `KV_REST_API_TOKEN` to use a real database instead of the in-memory one.

```
api/        Vercel functions: session, home (remotes and buttons), device, climate, learn, send, health
lib/        broadlink.js (the UDP protocol), auth.js (HomeyDeck login), home.js, device.js, redis.js, http.js
public/     the PWA: index.html, app.js, app.css, sw.js, manifest, icons
scripts/    dev server, in-memory Redis, fake RM4 Pro
test/       node --test
```
