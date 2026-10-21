import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// media/<slug>/ holds everything generated for one video. It's gitignored and
// mounted into n8n at /files.
export function videoDir(slug) {
  const dir = fileURLToPath(new URL(`../media/${slug}/`, import.meta.url));
  mkdirSync(dir, { recursive: true });
  return dir;
}
