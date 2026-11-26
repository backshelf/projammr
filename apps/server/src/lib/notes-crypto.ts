import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/** Who a note's key is currently wrapped for. */
export type KeyScope = `user:${string}` | `project:${number}`;

export const scopeFor = (
  authorId: string,
  projectId: number | null
): KeyScope =>
  projectId == null ? `user:${authorId}` : `project:${projectId}`;

/**
 * The key a scope's data keys are wrapped under. Derived, never stored: the
 * scope string and the version are the only inputs besides the master key, so
 * re-wrapping a note for a new scope needs nothing but the row itself.
 */
export const scopeKey = (master: Buffer, scope: KeyScope, version: number) =>
  Buffer.from(
    hkdfSync(
      "sha256",
      master,
      "",
      `projammr/notes/v${version}/${scope}`,
      KEY_BYTES
    )
  );

/** `iv || ciphertext || tag`, one buffer, so a column holds it whole. */
export const seal = (key: Buffer, plaintext: Buffer): Buffer => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  return Buffer.concat([
    iv,
    cipher.update(plaintext),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
};

/** Throws on a tampered or foreign-key ciphertext; callers let that surface as a 500. */
export const open = (key: Buffer, sealed: Buffer): Buffer => {
  const iv = sealed.subarray(0, IV_BYTES);
  const tag = sealed.subarray(sealed.length - TAG_BYTES);
  const body = sealed.subarray(IV_BYTES, sealed.length - TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
};

export type Envelope = {
  wrappedKey: Buffer;
  keyScope: KeyScope;
  keyVersion: number;
};

/**
 * The root keys a rotation needs both of, and the version `current` is. `current`
 * wraps every new envelope and unwraps a row already on `version`, `previous`
 * unwraps a row a rotation has not reached yet. `previous` is `null` outside a
 * rotation — every row is on `version` and there is nothing else to unwrap
 * with. `version` comes from `NOTES_KEY_VERSION`, raised by one per rotation.
 */
export type MasterKeys = {
  current: Buffer;
  previous: Buffer | null;
  version: number;
};

/**
 * The name `NOTES_MASTER_KEY_PREVIOUS` is set under, spelled out once so the
 * error naming it and the compose/`.env` docs describing it agree.
 */
export const PREVIOUS_KEY_ENV_VAR = "NOTES_MASTER_KEY_PREVIOUS";

const rootKeyFor = (keys: MasterKeys, version: number): Buffer => {
  if (version === keys.version) return keys.current;
  if (!keys.previous) {
    throw new Error(
      `A note is wrapped with key version ${version}, but ${PREVIOUS_KEY_ENV_VAR} is not set`
    );
  }
  return keys.previous;
};

/** A fresh data key for a new note, wrapped for its first scope under the current key. */
export const newEnvelope = (keys: MasterKeys, scope: KeyScope) => {
  const dataKey = randomBytes(KEY_BYTES);
  return {
    dataKey,
    envelope: {
      wrappedKey: seal(scopeKey(keys.current, scope, keys.version), dataKey),
      keyScope: scope,
      keyVersion: keys.version,
    } satisfies Envelope,
  };
};

export const unwrap = (keys: MasterKeys, env: Envelope): Buffer =>
  open(
    scopeKey(rootKeyFor(keys, env.keyVersion), env.keyScope, env.keyVersion),
    env.wrappedKey
  );

/**
 * The same data key under a different scope, wrapped fresh under the current
 * key and version — the note's content is untouched. Called with the note's
 * own scope unchanged, this is exactly a key rotation's re-wrap.
 */
export const rewrap = (
  keys: MasterKeys,
  env: Envelope,
  scope: KeyScope
): Envelope => ({
  wrappedKey: seal(
    scopeKey(keys.current, scope, keys.version),
    unwrap(keys, env)
  ),
  keyScope: scope,
  keyVersion: keys.version,
});

export const sealJson = (key: Buffer, value: unknown) =>
  seal(key, Buffer.from(JSON.stringify(value)));

export const openJson = <T>(key: Buffer, sealed: Buffer): T =>
  JSON.parse(open(key, sealed).toString()) as T;
