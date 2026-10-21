// Wikimedia Commons photo search: real photos of real places, stores and people,
// under free licenses. Most need a credit (author, license, link), which
// footage.json keeps for the video description.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Wikimedia asks API clients to identify themselves.
export const USER_AGENT = "video-pipeline/0.1 (https://github.com/jaketlee07)";
const CACHE_DIR = fileURLToPath(new URL("../media/.cache/commons/", import.meta.url));
const DAY_MS = 24 * 60 * 60 * 1000;
// Public domain, CC0, CC BY and CC BY-SA: free to use in a monetized video with a credit.
const FREE_LICENSE = /^(pd|cc0|cc-by-\d|cc-by-sa-\d)/i;

async function api(params) {
  const url = `https://commons.wikimedia.org/w/api.php?${new URLSearchParams({ action: "query", format: "json", formatversion: "2", ...params })}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Wikimedia Commons ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const plainText = (html = "") => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

// Landscape photos at least 1,920 pixels wide matching `query`, most relevant first.
export async function searchCommons(query) {
  const cachePath = join(CACHE_DIR, `${createHash("sha256").update(query).digest("hex").slice(0, 16)}.json`);
  if (existsSync(cachePath)) {
    const cached = JSON.parse(readFileSync(cachePath, "utf8"));
    if (Date.now() - cached.fetchedAt < DAY_MS) return cached.photos;
  }
  const data = await api({
    generator: "search",
    gsrnamespace: "6",
    gsrlimit: "20",
    gsrsearch: `${query} filetype:bitmap filew:>1919`,
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: "640",
    iiextmetadatafilter: "LicenseShortName|License|Artist",
  });
  const photos = (data.query?.pages ?? [])
    .sort((a, b) => a.index - b.index)
    .flatMap((page) => {
      const info = page.imageinfo?.[0];
      const meta = info?.extmetadata ?? {};
      if (!info || info.width <= info.height || !/jpeg|png/.test(info.mime) || !FREE_LICENSE.test(meta.License?.value ?? "")) return [];
      return [
        {
          title: page.title.replace(/^File:/, ""),
          pageid: page.pageid,
          pageURL: info.descriptionurl,
          author: plainText(meta.Artist?.value) || "unknown",
          license: meta.LicenseShortName?.value,
          width: info.width,
          height: info.height,
          thumbnail: info.thumburl,
        },
      ];
    });
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cachePath, JSON.stringify({ query, fetchedAt: Date.now(), photos }));
  return photos;
}

// The URL of a version about 2,560 pixels wide (or the original, if smaller).
export async function photoURL(title) {
  const data = await api({ titles: `File:${title}`, prop: "imageinfo", iiprop: "url", iiurlwidth: "2560" });
  const info = data.query?.pages?.[0]?.imageinfo?.[0];
  if (!info) throw new Error(`Wikimedia Commons has no file "${title}".`);
  return info.thumburl ?? info.url;
}
