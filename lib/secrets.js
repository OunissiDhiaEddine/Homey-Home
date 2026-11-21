// Hashing and password checks, the same as HomeyDeck's so its accounts work here.

import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);

/** n random bytes as base64url (16 bytes → 22 characters). */
export const randomId = (n = 16) => crypto.randomBytes(n).toString("base64url");

/** SHA-256 as base64url, used to store tokens without the secret itself. */
export const sha256 = (text) => crypto.createHash("sha256").update(text).digest("base64url");

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 64 };

/** scrypt with a random salt, in HomeyDeck's format. Used by the dev server's seed user. */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 128 * 1024 * 1024 });
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function checkPassword(password, stored) {
  const [kind, N, r, p, salt, key] = String(stored ?? "").split("$");
  if (kind !== "scrypt" || !key) {
    // Spend the same time as a real check so unknown usernames can't be told apart.
    await hashPassword(password);
    return false;
  }
  const want = Buffer.from(key, "base64url");
  const got = await scrypt(password, Buffer.from(salt, "base64url"), want.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: 128 * 1024 * 1024,
  });
  return crypto.timingSafeEqual(got, want);
}
