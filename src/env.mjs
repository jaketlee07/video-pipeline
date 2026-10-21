import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

export const ENV_PATH = fileURLToPath(new URL("../.env", import.meta.url));

// Reads .env without touching process.env. Exits with a hint if it doesn't exist.
export function loadEnv() {
  if (!existsSync(ENV_PATH)) {
    console.error("No .env file found. Run: cp .env.example .env");
    process.exit(1);
  }
  const env = parseEnv(readFileSync(ENV_PATH, "utf8"));
  for (const key of Object.keys(env)) env[key] = env[key].trim();
  return env;
}

// Sets KEY=value in .env, replacing the existing line or appending a new one.
export function setEnvValue(key, value) {
  const text = readFileSync(ENV_PATH, "utf8");
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  const next = pattern.test(text)
    ? text.replace(pattern, () => line)
    : `${text.replace(/\n?$/, "\n")}${line}\n`;
  writeFileSync(ENV_PATH, next);
}
