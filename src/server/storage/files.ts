import "server-only";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { env } from "@/lib/env";

/*
 * File contents on local disk under STORAGE_DIR (docs/documents.md). Keys
 * are built by the server from ids, never from user input. Files are written
 * once and never overwritten: a new version is a new key.
 */

const KEY = /^[a-z]+(\/[0-9a-f-]{36})+$/;

function resolveKey(key: string) {
  if (!KEY.test(key)) throw new Error(`Invalid storage key: ${key}`);
  return path.join(path.resolve(env().STORAGE_DIR), key);
}

/**
 * Streams a body to disk, hashing and counting as it goes, so a file of any
 * size never sits in memory. The file appears under its key only when
 * complete.
 */
export async function writeFile(key: string, body: ReadableStream<Uint8Array>) {
  const target = resolveKey(key);
  const partial = `${target}.partial`;
  await mkdir(path.dirname(target), { recursive: true });
  const hash = createHash("sha256");
  let sizeBytes = 0n;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk);
      sizeBytes += BigInt(chunk.length);
      done(null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]),
      meter,
      createWriteStream(partial, { flags: "wx" }),
    );
    await rename(partial, target);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
  return { sizeBytes, sha256: hash.digest("hex") };
}

/** Removes a file whose record was never saved. */
export async function discardFile(key: string) {
  await rm(resolveKey(key), { force: true });
}

/** A web stream of the file, and its size on disk. */
export async function readFile(key: string) {
  const file = resolveKey(key);
  const { size } = await stat(file);
  const stream = Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>;
  return { stream, size };
}
