/**
 * A small client for Broadlink's local UDP protocol, enough for an RM4 Pro:
 * hello (who are you), auth, temperature/humidity, IR + RF learning and
 * sending codes. No dependencies, just node:dgram and node:crypto.
 *
 * The RM4 listens on UDP port 80. Homey Home reaches it from Vercel through
 * your DDNS name and a UDP port forward on the router, so every packet here
 * crosses the internet: each exchange retries a few times and gives up after
 * a few seconds.
 *
 * Packet layout follows mjg59/python-broadlink (the library Home Assistant
 * uses): a 0x38-byte header, then an AES-128-CBC payload. Auth (0x65) swaps
 * the well-known default key for a per-session key and id; commands (0x6a)
 * use that key. RM4 commands carry a 6-byte frame: <u16 length><u32 command>.
 */

import dgram from "node:dgram";
import crypto from "node:crypto";
import net from "node:net";
import { lookup } from "node:dns/promises";

export const DEFAULT_PORT = 80;
export const DEFAULT_DEVTYPE = 0x520b; // RM4 pro
const INIT_KEY = Buffer.from("097628343fe99e23765c1513accf8b02", "hex");
const IV = Buffer.from("562e17996d093d28ddb3ba695a2e6f58", "hex");

export const CMD = {
  SEND: 0x02,
  LEARN_IR: 0x03,
  CHECK_DATA: 0x04,
  RF_SWEEP: 0x19,
  RF_CHECK_FREQ: 0x1a,
  RF_FIND_PACKET: 0x1b,
  RF_CANCEL: 0x1e,
  SENSORS: 0x24,
};

const ERRORS = {
  [-1]: "authentication failed",
  [-2]: "logged out",
  [-3]: "the device is offline",
  [-4]: "command not supported",
  [-5]: "device storage is full",
  [-6]: "structure is abnormal",
  [-7]: "control key expired",
  [-8]: "send error",
  [-9]: "write error",
  [-10]: "read error",
};

/** Error codes that mean "authenticate again". */
const AUTH_CODES = new Set([-1, -2, -7, -4012]);

export class BroadlinkError extends Error {
  constructor(code, message) {
    super(message ?? ERRORS[code] ?? `device error ${code}`);
    this.code = code;
  }
  get authProblem() {
    return AUTH_CODES.has(this.code);
  }
  get timeout() {
    return this.code === -4000;
  }
}

export const checksum = (buf, from = 0xbeaf) => {
  let sum = from;
  for (const b of buf) sum += b;
  return sum & 0xffff;
};

function aes(key, data, decrypt = false) {
  const c = decrypt ? crypto.createDecipheriv("aes-128-cbc", key, IV) : crypto.createCipheriv("aes-128-cbc", key, IV);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(data), c.final()]);
}

export const encrypt = (key, data) => aes(key, data);
export const decrypt = (key, data) => aes(key, data.subarray(0, data.length - (data.length % 16)), true);

/** AA:BB:CC:DD:EE:FF or AABBCCDDEEFF → 6 bytes (display order), or null. */
export function parseMac(text) {
  const hex = String(text ?? "").replace(/[:\-. ]/g, "");
  return /^[0-9a-fA-F]{12}$/.test(hex) ? Buffer.from(hex, "hex") : null;
}
export const formatMac = (buf) => buf.toString("hex").toUpperCase().match(/../g).join(":");

/** Resolves a DDNS name to an IPv4 address (the RM4 only speaks IPv4). */
export async function resolveHost(host) {
  if (net.isIPv4(host)) return host;
  try {
    const { address } = await lookup(host, { family: 4 });
    return address;
  } catch (err) {
    throw new BroadlinkError(-4001, `${host} doesn't resolve to an IPv4 address (${err.code ?? err.message})`);
  }
}

/**
 * Sends one packet and waits for the first reply from that address, sending
 * it again every retryMs since UDP can drop it.
 */
export function exchange(ip, port, packet, { timeoutMs = 5000, retryMs = 1200 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    let done = false;
    const finish = (err, data) => {
      if (done) return;
      done = true;
      clearInterval(resend);
      clearTimeout(timer);
      socket.close();
      err ? reject(err) : resolve(data);
    };
    const send = () => socket.send(packet, port, ip, (err) => err && finish(new BroadlinkError(-4002, `couldn't send to the device: ${err.message}`)));
    socket.on("message", (msg, rinfo) => {
      if (rinfo.address === ip) finish(null, msg);
    });
    socket.on("error", (err) => finish(new BroadlinkError(-4002, err.message)));
    const resend = setInterval(send, retryMs);
    const timer = setTimeout(() => finish(new BroadlinkError(-4000, "the RM4 didn't answer (is it online, and is the UDP port forwarded?)")), timeoutMs);
    send();
  });
}

/** The 12-byte timestamp a hello packet carries. */
function packDate(d = new Date()) {
  const out = Buffer.alloc(12);
  out.writeInt32LE(0, 0); // UTC
  out.writeUInt16LE(d.getUTCFullYear(), 4);
  out[6] = d.getUTCMinutes();
  out[7] = d.getUTCHours();
  out[8] = d.getUTCFullYear() % 100;
  out[9] = d.getUTCDay() || 7;
  out[10] = d.getUTCDate();
  out[11] = d.getUTCMonth() + 1;
  return out;
}

export function helloPacket(now = new Date()) {
  const p = Buffer.alloc(0x30);
  packDate(now).copy(p, 0x08);
  p[0x26] = 6;
  p.writeUInt16LE(checksum(p), 0x20);
  return p;
}

export function parseHello(resp) {
  if (resp.length < 0x40) throw new BroadlinkError(-4007, "the device's hello answer was too short");
  return {
    devtype: resp.readUInt16LE(0x34),
    mac: formatMac(Buffer.from(resp.subarray(0x3a, 0x40)).reverse()),
    name: resp.subarray(0x40).toString("utf8").split("\0")[0].trim(),
    locked: resp.length > 0x7f ? Boolean(resp[0x7f]) : false,
  };
}

export const MODELS = {
  0x520b: "RM4 pro",
  0x5213: "RM4 pro",
  0x5218: "RM4C pro",
  0x6026: "RM4 pro",
  0x6184: "RM4C pro",
  0x61a2: "RM4 pro",
  0x649b: "RM4 pro",
  0x653c: "RM4 pro",
};
export const modelName = (devtype) => MODELS[devtype] ?? `Broadlink 0x${Number(devtype).toString(16)}`;

export class Device {
  /**
   * @param {{host: string, port?: number, mac?: string, devtype?: number, timeoutMs?: number}} options
   */
  constructor({ host, port = DEFAULT_PORT, mac, devtype = DEFAULT_DEVTYPE, timeoutMs = 5000 }) {
    this.host = host;
    this.port = Number(port) || DEFAULT_PORT;
    this.mac = parseMac(mac) ?? Buffer.alloc(6);
    this.devtype = Number(devtype) || DEFAULT_DEVTYPE;
    this.timeoutMs = timeoutMs;
    this.ip = null;
    this.id = 0;
    this.key = INIT_KEY;
    this.count = crypto.randomInt(0x8000, 0x10000);
  }

  async address() {
    this.ip ??= await resolveHost(this.host);
    return this.ip;
  }

  /** Asks the device who it is: model, MAC, name and whether it's locked. */
  async hello() {
    const resp = await exchange(await this.address(), this.port, helloPacket(), { timeoutMs: this.timeoutMs });
    const info = parseHello(resp);
    this.devtype = info.devtype;
    this.mac = parseMac(info.mac);
    return info;
  }

  /** A session from an earlier request, so we can skip the auth round trip. */
  restore({ id, key }) {
    this.id = Number(id) >>> 0;
    this.key = Buffer.from(key, "hex");
  }

  session() {
    return { ip: this.ip, id: this.id, key: this.key.toString("hex") };
  }

  buildPacket(type, payload) {
    this.count = ((this.count + 1) | 0x8000) & 0xffff;
    const header = Buffer.alloc(0x38);
    Buffer.from("5aa5aa555aa5aa55", "hex").copy(header, 0);
    header.writeUInt16LE(this.devtype, 0x24);
    header.writeUInt16LE(type, 0x26);
    header.writeUInt16LE(this.count, 0x28);
    Buffer.from(this.mac).reverse().copy(header, 0x2a);
    header.writeUInt32LE(this.id, 0x30);
    header.writeUInt16LE(checksum(payload), 0x34);
    const padded = Buffer.concat([payload, Buffer.alloc((16 - (payload.length % 16)) % 16)]);
    const packet = Buffer.concat([header, encrypt(this.key, padded)]);
    packet.writeUInt16LE(checksum(packet), 0x20);
    return packet;
  }

  async sendPacket(type, payload) {
    const resp = await exchange(await this.address(), this.port, this.buildPacket(type, payload), { timeoutMs: this.timeoutMs });
    if (resp.length < 0x30) throw new BroadlinkError(-4007, "the device's answer was too short");
    const nominal = resp.readUInt16LE(0x20);
    const real = (checksum(resp) - resp[0x20] - resp[0x21]) & 0xffff;
    if (nominal !== real) throw new BroadlinkError(-4008, "the device's answer was corrupted");
    const error = resp.readInt16LE(0x22);
    if (error) throw new BroadlinkError(error);
    return decrypt(this.key, resp.subarray(0x38));
  }

  async auth() {
    this.id = 0;
    this.key = INIT_KEY;
    const payload = Buffer.alloc(0x50);
    payload.fill(0x31, 0x04, 0x14);
    payload[0x1e] = 0x01;
    payload[0x2d] = 0x01;
    payload.write("Test 1", 0x30, "ascii");
    const out = await this.sendPacket(0x65, payload);
    if (out.length < 0x14) throw new BroadlinkError(-4010, "the device's auth answer was too short");
    this.id = out.readUInt32LE(0);
    this.key = Buffer.from(out.subarray(0x04, 0x14));
    return this.session();
  }

  /** An RM4 command: <u16 len><u32 cmd><data>; the answer's data starts at 6. */
  async command(cmd, data = Buffer.alloc(0)) {
    const frame = Buffer.alloc(6);
    frame.writeUInt16LE(data.length + 4, 0);
    frame.writeUInt32LE(cmd, 2);
    const out = await this.sendPacket(0x6a, Buffer.concat([frame, data]));
    const len = out.readUInt16LE(0);
    return out.subarray(6, Math.min(len + 2, out.length));
  }

  /** The HTS2 cable's reading. All zeros means no sensor is plugged in. */
  async sensors() {
    const r = await this.command(CMD.SENSORS);
    if (r.length < 4) throw new BroadlinkError(-4, "this device has no temperature sensor");
    const temperature = r.readInt8(0) + r.readInt8(1) / 100;
    const humidity = r[2] + r[3] / 100;
    return { temperature: Math.round(temperature * 10) / 10, humidity: Math.round(humidity * 10) / 10 };
  }

  sendCode(code) {
    return this.command(CMD.SEND, code);
  }

  learnIr() {
    return this.command(CMD.LEARN_IR);
  }

  /** The learned code, or null while there's nothing yet. */
  async checkData() {
    try {
      const data = await this.command(CMD.CHECK_DATA);
      return data.length > 4 ? Buffer.from(data) : null;
    } catch (err) {
      if (err instanceof BroadlinkError && !err.authProblem && !err.timeout && err.code > -4000) return null;
      throw err;
    }
  }

  sweepRf() {
    return this.command(CMD.RF_SWEEP);
  }

  /** {found, frequency in MHz} while the user holds the remote's button. */
  async checkRfFrequency() {
    const r = await this.command(CMD.RF_CHECK_FREQ);
    return { found: Boolean(r[0]), frequency: r.length >= 5 ? r.readUInt32LE(1) / 1000 : 0 };
  }

  findRfPacket(frequency) {
    const data = Buffer.alloc(frequency ? 4 : 0);
    if (frequency) data.writeUInt32LE(Math.round(frequency * 1000), 0);
    return this.command(CMD.RF_FIND_PACKET, data);
  }

  cancelRf() {
    return this.command(CMD.RF_CANCEL);
  }
}

// --- codes -------------------------------------------------------------------

export const MAX_CODE_BYTES = 16 * 1024;

/** What a code is, from its first byte: 0x26 IR, 0xb2 RF 433 MHz, 0xd7 RF 315 MHz. */
export function codeKind(buf) {
  if (buf[0] === 0x26) return "ir";
  if (buf[0] === 0xb2 || buf[0] === 0xd7) return "rf";
  return "unknown";
}

/**
 * Accepts a code as Broadlink base64 (what Home Assistant, SmartIR and
 * Homey Home use), with or without a "b64:" prefix, or as hex.
 */
export function parseCode(text) {
  let raw = String(text ?? "").trim().replace(/^b64:/i, "").replace(/\s+/g, "");
  if (!raw) return null;
  let buf;
  if (/^(0x)?[0-9a-f]+$/i.test(raw) && raw.replace(/^0x/i, "").length % 2 === 0 && raw.length >= 16) {
    buf = Buffer.from(raw.replace(/^0x/i, ""), "hex");
  } else if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(raw)) {
    buf = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  } else return null;
  if (buf.length < 8 || buf.length > MAX_CODE_BYTES) return null;
  return buf;
}
