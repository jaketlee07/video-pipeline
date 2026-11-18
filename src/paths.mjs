import { existsSync, mkdirSync, renameSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// media/<slug>/ holds everything generated for one video. It's gitignored and
// mounted into n8n at /files.
export function videoDir(slug) {
  const dir = fileURLToPath(new URL(`../media/${slug}/`, import.meta.url));
  mkdirSync(dir, { recursive: true });
  return dir;
}

// Before a file is replaced: moves it to earlier/ beside it, stamped with the time,
// so no version is ever lost.
export function keepEarlier(path) {
  if (!existsSync(path)) return;
  const earlier = join(dirname(path), "earlier");
  mkdirSync(earlier, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  renameSync(path, join(earlier, basename(path).replace(/(\.\w+)?$/, `-${stamp}$1`)));
}
