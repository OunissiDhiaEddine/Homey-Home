// A pretend RM4 Pro for trying Homey Home without the real one:
//   node scripts/fake-rm4.js            (listens on UDP 127.0.0.1:8780)
// Then in the app's Settings use address 127.0.0.1 and port 8780.
// It answers hello and auth, reports a drifting temperature and humidity,
// "learns" a made-up IR code 3 s after you start (RF: finds 433.92 MHz after
// 3 s, then a code 2 s later), and logs every code it's asked to send.
import dgram from "node:dgram";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { checksum, encrypt, decrypt } from "../lib/broadlink.js";

const INIT_KEY = Buffer.from("097628343fe99e23765c1513accf8b02", "hex");

export function startFakeRm4({ port = 8780, host = "127.0.0.1", learnDelayMs = 3000, log = console.log, locked = false } = {}) {
  const sessions = new Map(); // id → key
  const state = { temperature: 23.4, humidity: 48.0, learning: null, sent: [] };
  const mac = Buffer.from("e870720a1b2c", "hex");
  const devtype = 0x520b;

  const reply = (rinfo, buf) => socket.send(buf, rinfo.port, rinfo.address);

  function packet(type, payload, key, error = 0) {
    const header = Buffer.alloc(0x38);
    Buffer.from("5aa5aa555aa5aa55", "hex").copy(header, 0);
    header.writeInt16LE(error, 0x22);
    header.writeUInt16LE(devtype, 0x24);
    header.writeUInt16LE(type, 0x26);
    const padded = Buffer.concat([payload, Buffer.alloc((16 - (payload.length % 16)) % 16)]);
    const out = Buffer.concat([header, payload.length ? encrypt(key, padded) : Buffer.alloc(0)]);
    out.writeUInt16LE(checksum(out), 0x20);
    return out;
  }

  const frame = (data = Buffer.alloc(0)) => {
    const f = Buffer.alloc(6);
    f.writeUInt16LE(data.length + 4, 0);
    return Buffer.concat([f, data]);
  };

  function fakeCode(kind) {
    const body = crypto.randomBytes(kind === "rf" ? 120 : 60);
    const head = Buffer.from([kind === "rf" ? 0xb2 : 0x26, 0x00, body.length & 0xff, body.length >> 8]);
    return Buffer.concat([head, body, Buffer.from([0x0d, 0x05])]);
  }

  function command(cmd, data) {
    const now = Date.now();
    switch (cmd) {
      case 0x24: {
        state.temperature = Math.round((state.temperature + (Math.random() - 0.5) * 0.3) * 100) / 100;
        state.humidity = Math.round((state.humidity + (Math.random() - 0.5) * 0.8) * 100) / 100;
        const t = Math.trunc(state.temperature);
        const h = Math.trunc(state.humidity);
        return [0, frame(Buffer.from([t & 0xff, Math.round((state.temperature - t) * 100), h, Math.round((state.humidity - h) * 100)]))];
      }
      case 0x03:
        state.learning = { kind: "ir", at: now };
        log("learning IR…");
        return [0, frame()];
      case 0x19:
        state.learning = { kind: "rf", at: now, phase: "sweep" };
        log("sweeping RF frequencies…");
        return [0, frame()];
      case 0x1a: {
        const found = state.learning?.kind === "rf" && now - state.learning.at > learnDelayMs;
        const d = Buffer.alloc(5);
        d[0] = found ? 1 : 0;
        d.writeUInt32LE(found ? 433920 : 0, 1);
        return [0, frame(d)];
      }
      case 0x1b:
        state.learning = { kind: "rf", at: now, phase: "find" };
        log(`looking for an RF packet${data.length >= 4 ? ` at ${data.readUInt32LE(0) / 1000} MHz` : ""}…`);
        return [0, frame()];
      case 0x1e:
        state.learning = null;
        return [0, frame()];
      case 0x04: {
        const l = state.learning;
        const wait = l?.kind === "rf" ? (l.phase === "find" ? learnDelayMs * 0.66 : Infinity) : learnDelayMs;
        if (!l || now - l.at < wait) return [-10, Buffer.alloc(0)];
        state.learning = null;
        const code = fakeCode(l.kind);
        log(`learned a ${l.kind.toUpperCase()} code (${code.length} bytes)`);
        return [0, frame(code)];
      }
      case 0x02:
        state.sent.push(Buffer.from(data));
        log(`sent a ${data[0] === 0x26 ? "IR" : "RF"} code (${data.length} bytes)`);
        return [0, frame()];
      default:
        return [-4, Buffer.alloc(0)];
    }
  }

  const socket = dgram.createSocket("udp4");
  socket.on("message", (msg, rinfo) => {
    if (msg.length === 0x30 && msg[0x26] === 6) {
      const r = Buffer.alloc(0x80);
      r.writeUInt16LE(devtype, 0x34);
      Buffer.from(mac).reverse().copy(r, 0x3a);
      r.write("Fake RM4 pro", 0x40);
      r[0x7f] = locked ? 1 : 0;
      r.writeUInt16LE(checksum(r), 0x20);
      return reply(rinfo, r);
    }
    if (msg.length < 0x38 || msg.subarray(0, 8).toString("hex") !== "5aa5aa555aa5aa55") return;
    const type = msg.readUInt16LE(0x26);
    if (type === 0x65) {
      const id = crypto.randomInt(1, 2 ** 31);
      const key = crypto.randomBytes(16);
      sessions.set(id, key);
      const out = Buffer.alloc(0x20);
      out.writeUInt32LE(id, 0);
      key.copy(out, 4);
      return reply(rinfo, packet(0x3e9, out, INIT_KEY));
    }
    if (type === 0x6a) {
      const key = sessions.get(msg.readUInt32LE(0x30));
      if (!key) return reply(rinfo, packet(0x3ee, Buffer.alloc(0), INIT_KEY, -7));
      const payload = decrypt(key, msg.subarray(0x38));
      const len = payload.readUInt16LE(0);
      const cmd = payload.readUInt32LE(2);
      const [error, out] = command(cmd, payload.subarray(6, len + 2));
      return reply(rinfo, packet(0x3ee, out, key, error));
    }
  });
  return new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(port, host, () => {
      socket.off("error", reject);
      resolve({ port: socket.address().port, state, sessions, close: () => socket.close() });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8780);
  const fake = await startFakeRm4({ port });
  console.log(`Fake RM4 pro on udp://127.0.0.1:${fake.port}`);
}
