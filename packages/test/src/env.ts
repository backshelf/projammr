/** The value each stubbed variable had before its first stub; `undefined` means unset. */
const originals = new Map<string, string | undefined>();

/** Sets an environment variable for the rest of a test; `undefined` unsets it. */
export function stubEnv(name: string, value: string | undefined) {
  if (!originals.has(name)) originals.set(name, process.env[name]);
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

/** Restores every variable `stubEnv` touched to what it was before. */
export function unstubAllEnvs() {
  for (const [name, value] of originals) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  originals.clear();
}
