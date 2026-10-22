import { createHmac } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Buffer {
  let bits = "";
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const value = BASE32.indexOf(char);
    if (value < 0) throw new Error(`Invalid base32 character: ${char}`);
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** RFC 6238 code for the secret in an `otpauth://` URI, as an authenticator app would show it. */
export function totpCode(otpauthUri: string, at = Date.now()): string {
  const secret = new URL(otpauthUri).searchParams.get("secret");
  if (!secret) throw new Error("URI has no secret");
  return totpFromKey(base32Decode(secret), at);
}

/** Code for a secret as Better Auth stores it (the raw string, before base32). */
export function totpCodeForSecret(rawSecret: string, at = Date.now()): string {
  return totpFromKey(Buffer.from(rawSecret, "utf8"), at);
}

function totpFromKey(key: Buffer, at: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const value = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return value.toString().padStart(6, "0");
}
