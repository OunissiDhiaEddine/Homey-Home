import test from "node:test";
import assert from "node:assert/strict";
import { Device, BroadlinkError, helloPacket, parseHello, checksum, parseCode, codeKind } from "../lib/broadlink.js";
import { startFakeRm4 } from "../scripts/fake-rm4.js";

const quiet = () => {};

test("hello packet has the discovery marker and a valid checksum", () => {
  const p = helloPacket(new Date(Date.UTC(2026, 10, 21, 20, 5)));
  assert.equal(p.length, 0x30);
  assert.equal(p[0x26], 6);
  assert.equal(p.readUInt16LE(0x0c), 2026);
  const sum = (checksum(p) - p[0x20] - p[0x21]) & 0xffff;
  assert.equal(p.readUInt16LE(0x20), sum);
});

test("talks to a (fake) RM4 pro: hello, auth, sensors, send", async () => {
  const fake = await startFakeRm4({ port: 0, log: quiet });
  try {
    const dev = new Device({ host: "127.0.0.1", port: fake.port, timeoutMs: 1500 });
    const info = await dev.hello();
    assert.equal(info.devtype, 0x520b);
    assert.equal(info.mac, "E8:70:72:0A:1B:2C");
    assert.equal(info.name, "Fake RM4 pro");
    assert.equal(info.locked, false);

    const s = await dev.auth();
    assert.ok(s.id > 0);
    assert.equal(s.key.length, 32);

    const r = await dev.sensors();
    assert.ok(r.temperature > 20 && r.temperature < 27, `temperature ${r.temperature}`);
    assert.ok(r.humidity > 40 && r.humidity < 56, `humidity ${r.humidity}`);

    const code = parseCode("JgBQAAABKZMSEhI3EhISEhISEhISEhI3EjcSEhI3EjcSNxI3EjcSEhISEjcSEhISEhISEhISEjcSNxISEjcSNxI3EjcSNxIABSoAASlIEgANBQ==");
    assert.equal(codeKind(code), "ir");
    await dev.sendCode(code);
    assert.deepEqual(fake.state.sent.at(-1), code);

    // A restored session works without a new auth.
    const again = new Device({ host: "127.0.0.1", port: fake.port, timeoutMs: 1500 });
    await again.address();
    again.restore(s);
    await again.sensors();

    // A session the device doesn't know answers with an auth error.
    const stale = new Device({ host: "127.0.0.1", port: fake.port, timeoutMs: 1500 });
    stale.restore({ id: 12345, key: "00112233445566778899aabbccddeeff" });
    await assert.rejects(stale.sensors(), (err) => err instanceof BroadlinkError && err.authProblem);
  } finally {
    fake.close();
  }
});

test("learns IR and RF codes", async () => {
  const fake = await startFakeRm4({ port: 0, log: quiet, learnDelayMs: 150 });
  try {
    const dev = new Device({ host: "127.0.0.1", port: fake.port, timeoutMs: 1500 });
    await dev.auth();
    await dev.learnIr();
    assert.equal(await dev.checkData(), null);
    await new Promise((r) => setTimeout(r, 200));
    const ir = await dev.checkData();
    assert.equal(codeKind(ir), "ir");

    await dev.sweepRf();
    assert.equal((await dev.checkRfFrequency()).found, false);
    await new Promise((r) => setTimeout(r, 200));
    const f = await dev.checkRfFrequency();
    assert.deepEqual(f, { found: true, frequency: 433.92 });
    await dev.findRfPacket(f.frequency);
    await new Promise((r) => setTimeout(r, 150));
    const rf = await dev.checkData();
    assert.equal(codeKind(rf), "rf");
    await dev.cancelRf();
  } finally {
    fake.close();
  }
});

test("times out when nothing answers", async () => {
  const dev = new Device({ host: "127.0.0.1", port: 9, timeoutMs: 400 });
  await assert.rejects(dev.auth(), (err) => err instanceof BroadlinkError && err.timeout);
});

test("parses codes as base64, b64: prefix or hex", () => {
  assert.ok(parseCode("b64:JgBQAAABKZMSEhI3EhISEhISEhISEhI3"));
  assert.ok(parseCode("2600500000012993121212371212"));
  assert.equal(parseCode("hello world"), null);
  assert.equal(parseCode(""), null);
  assert.deepEqual(parseHello(Buffer.alloc(0x80)).mac, "00:00:00:00:00:00");
});
