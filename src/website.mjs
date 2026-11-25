// Real web pages, captured with Playwright (`npx playwright install chromium`
// once), for two kinds of scene:
// - website scenes: a site as a viewer would see it, with a few words on it circled;
// - document scenes whose source is a web page: the real article with the quoted
//   words highlighted (or, with no quote, its headline underlined), shown instead
//   of the paper card when the quote is really on the page.
//
// The copy comes from the Internet Archive's Wayback Machine whenever it has one:
// for a website scene, from the scene's date (or, for how a site looks today, from
// the last few weeks), so it shows what the site looked like then; for an article,
// the first copy from the day it came out on, since articles don't change. Company
// sites aren't loaded by a robot that way. A page the archive doesn't have (or,
// for an article, whose copies don't show the quote) is loaded live, and a page
// that blocks automated browsers or asks for a CAPTCHA is skipped, never worked
// around. So is one where something covers the quote.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const VIEW = { width: 1440, height: 900 };
// How far down a page the scene can scroll, in screen heights.
const MAX_SCREENS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
// How far an archived copy of a website may be from the date asked for.
const PAST_TOLERANCE_DAYS = 120;
const TODAY_TOLERANCE_DAYS = 60;
// Archived copies tried, nearest the date first, until one renders well.
const COPIES_TRIED = 4;
const ARTICLE_COPIES_TRIED = 3;
// Words further down than this are shown below the top of the page, with the
// stretch in between cut out.
const DEEP_SCREENS = 2.6;
const CUT_HEIGHT = 56;
const BLOCKED = /captcha|are you a robot|not a robot|verify (that )?you are (a )?human|access denied|unusual traffic|press (&|and) hold|just a moment\.\.\./i;
// A page that's gone but still answers 200.
const MISSING = /page (you('re| are) looking for )?(doesn't|does not|could not|couldn't|can't|cannot) (exist|be found)|page not found|\b404\b|no longer available/i;
// Buttons that turn down a cookie banner. One that only accepts is left alone.
const DECLINE = /^(reject( all)?( cookies)?|decline( all)?|deny( all)?|(use )?(only )?(strictly )?necessary( cookies)?( only)?|reject non-essential( cookies)?|no,? thanks)$/i;

const stamp = (date) => date.replace(/-/g, "").slice(0, 8);
const isoOf = (timestamp) => `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`;

// "June 18, 2025" → "2025-06-18"; "FY2024-25" → "2024-01-01"; "Current guidance" → null.
export function dateOf(text) {
  const year = text?.match(/\b(19|20)\d{2}\b/)?.[0];
  if (!year) return null;
  const parsed = Date.parse(`${text.replace(/^(about|around|circa|c\.)\s+/i, "")} 12:00 UTC`);
  const iso = Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
  return iso?.startsWith(year) ? iso : `${year}-01-01`;
}

// The Wayback Machine's copies (at most one a day), in its bare "if_" view
// without the archive toolbar. For a website, the ones nearest the date; for an
// article, the first ones from its date on (or the latest, with no date).
async function archivedCopies(url, date, article) {
  const params = { url, output: "json", filter: "statuscode:200", collapse: "timestamp:8" };
  if (article) Object.assign(params, date ? { from: stamp(date), limit: String(ARTICLE_COPIES_TRIED) } : { limit: String(-ARTICLE_COPIES_TRIED) });
  else {
    const wanted = date ?? new Date().toISOString().slice(0, 10);
    const days = date ? PAST_TOLERANCE_DAYS : TODAY_TOLERANCE_DAYS;
    const shift = (n) => new Date(Date.parse(wanted) + n * DAY_MS).toISOString().slice(0, 10);
    Object.assign(params, { from: stamp(shift(-days)), to: stamp(shift(date ? days : 0)) });
  }
  const res = await fetch(`https://web.archive.org/cdx/search/cdx?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) return [];
  let rows = ((await res.json()) ?? []).slice(1);
  if (article) rows = date ? rows : rows.reverse();
  else {
    const wanted = Date.parse(date ?? new Date().toISOString().slice(0, 10));
    const apart = (ts) => Math.abs(Date.parse(isoOf(ts)) - wanted);
    rows = rows.sort((a, b) => apart(a[1]) - apart(b[1])).slice(0, COPIES_TRIED);
  }
  return rows.map(([, ts, original]) => ({ url: `https://web.archive.org/web/${ts}if_/${original}`, pageURL: `https://web.archive.org/web/${ts}/${original}`, date: isoOf(ts) }));
}

// Loads a page and scrolls through it once so lazy images load. Returns how tall
// it is and what share of its pictures loaded, or { error }.
async function load(page, url) {
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 }).catch((err) => ({ failed: err.message }));
  if (!response || response.failed) return { error: "the page didn't load" };
  if (response.status() >= 400) return { error: `the page answered ${response.status()}` };
  if (!/html/i.test(response.headers()["content-type"] ?? "html")) return { error: "it isn't a web page" };
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  const text = await page.evaluate(() => document.body?.innerText ?? "");
  if (BLOCKED.test(text.slice(0, 3000)) || text.trim().length < 150) return { error: "the page blocks automated browsers or shows a check; skipped" };
  const heading = await page.evaluate(() => `${document.title} ${document.querySelector("h1")?.innerText ?? ""}`);
  if (MISSING.test(heading)) return { error: "the page says it doesn't exist" };
  await declineCookies(page);
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await scrollThrough(page, 0, Math.min(height, MAX_SCREENS * VIEW.height));
  const { loaded, total } = await page.evaluate((limit) => {
    const pictures = [...document.images].filter((img) => {
      const r = img.getBoundingClientRect();
      return r.top < limit && r.width > 40 && r.height > 40;
    });
    return { total: pictures.length, loaded: pictures.filter((img) => img.complete && img.naturalWidth > 0).length };
  }, MAX_SCREENS * VIEW.height);
  return { height, quality: total ? loaded / total : 1 };
}

// Turns down a cookie banner, if it has a button for that, so it doesn't cover the
// page. Never accepts one.
async function declineCookies(page) {
  const buttons = page.locator("button, a, [role=button], input[type=button]");
  const count = Math.min(await buttons.count(), 400);
  for (let i = 0; i < count; i++) {
    const button = buttons.nth(i);
    const label = ((await button.innerText({ timeout: 500 }).catch(() => "")) || (await button.getAttribute("value").catch(() => "")) || "").trim();
    if (!DECLINE.test(label) || !(await button.isVisible().catch(() => false))) continue;
    await button.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(800);
    return;
  }
}

// Scrolls from one point to another in half-screen steps, so lazy images there
// load, then back to the top.
async function scrollThrough(page, from, to) {
  for (let y = from; y < to; y += VIEW.height / 2) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(350);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(800);
}

// Runs in the page. Finds words on it however they're punctuated or broken up
// (curly or straight quotes, dashes, "$1,265,000" or "$1.265.000", markup in the
// middle), comparing letters and digits only, at word boundaries. Returns the
// lines they sit on, in page pixels:
//   { focus, marks, covered } — focus: the box to scroll to (the whole quote),
//   marks: the lines to mark (the highlighted words, or the quote, or the headline)
// or { error }.
function locateInPage({ fragments, highlight, headline }) {
  const ALNUM = /[\p{L}\p{N}]/u;
  const INVISIBLE = /[­​-‍﻿]/;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest("script, style, noscript, template") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  let stream = "";
  const at = [];
  const wordStart = [];
  let previousAlnum = false;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    for (let i = 0; i < n.data.length; i++) {
      const c = n.data[i];
      if (INVISIBLE.test(c)) continue;
      if (!ALNUM.test(c)) {
        previousAlnum = false;
        continue;
      }
      const lower = c.toLowerCase();
      stream += lower.length === 1 ? lower : c;
      at.push([n, i]);
      wordStart.push(!previousAlnum);
      previousAlnum = true;
    }
  }
  const letters = (text) =>
    [...text]
      .filter((c) => ALNUM.test(c))
      .map((c) => (c.toLowerCase().length === 1 ? c.toLowerCase() : c))
      .join("");

  // The lines a range sits on: its boxes, joined where they share a line.
  const lines = (range) => {
    const out = [];
    for (const r of range.getClientRects()) {
      if (r.width < 2 || r.height < 4) continue;
      const box = { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
      const line = out.find((l) => Math.abs(l.y + l.height / 2 - (box.y + box.height / 2)) < Math.min(l.height, box.height) / 2);
      if (!line) {
        out.push(box);
        continue;
      }
      const [x1, y1] = [Math.max(line.x + line.width, box.x + box.width), Math.max(line.y + line.height, box.y + box.height)];
      line.x = Math.min(line.x, box.x);
      line.y = Math.min(line.y, box.y);
      line.width = x1 - line.x;
      line.height = y1 - line.y;
    }
    return out;
  };
  const visible = (node) => node.parentElement?.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) ?? true;
  // Symbols at either end of the words ("$1.2 million", "325%") are marked too.
  const find = (text, near = null) => {
    const needle = letters(text);
    if (needle.length < 2) return null;
    const head = text.trim().match(/^[$€£#]+/)?.[0] ?? "";
    const tail = text.trim().match(/[%]+$/)?.[0] ?? "";
    for (let s = stream.indexOf(needle); s !== -1; s = stream.indexOf(needle, s + 1)) {
      const e = s + needle.length;
      if (!wordStart[s] || (e < stream.length && !wordStart[e])) continue;
      if (near && (s < near.s - 400 || e > near.e + 400)) continue;
      if (!visible(at[s][0])) continue;
      const [[first, from], [last, to]] = [at[s], at[e - 1]];
      const before = head && from >= head.length && first.data.slice(from - head.length, from) === head ? head.length : 0;
      const after = tail && last.data.startsWith(tail, to + 1) ? tail.length : 0;
      const range = document.createRange();
      range.setStart(first, from - before);
      range.setEnd(last, to + 1 + after);
      const rects = lines(range);
      if (rects.length) return { s, e, range, rects };
    }
    return null;
  };
  const union = (rects) => {
    const [x0, y0] = [Math.min(...rects.map((r) => r.x)), Math.min(...rects.map((r) => r.y))];
    const [x1, y1] = [Math.max(...rects.map((r) => r.x + r.width)), Math.max(...rects.map((r) => r.y + r.height))];
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  };
  // Whether something sits on top of the words (a pop-up, a paywall).
  const covered = (found) => {
    const r = found.rects[0];
    window.scrollTo(0, Math.max(0, r.y - innerHeight / 2));
    const hit = document.elementFromPoint(r.x - scrollX + Math.min(r.width / 2, 24), r.y - scrollY + r.height / 2);
    const own = found.range.commonAncestorContainer;
    const element = own.nodeType === 1 ? own : own.parentElement;
    window.scrollTo(0, 0);
    return !(hit && (element.contains(hit) || hit.contains(element)));
  };

  if (fragments.length) {
    let quote = null;
    for (const fragment of fragments) if ((quote = find(fragment))) break;
    if (!quote) return { error: "the quote isn't on the page" };
    const words = highlight ? find(highlight, quote) : null;
    return { focus: union(quote.rects), marks: (words ?? quote).rects, covered: covered(quote) };
  }
  if (highlight) {
    const words = find(highlight);
    if (!words) return { error: `"${highlight}" isn't on the page` };
    return { focus: union(words.rects), marks: words.rects, covered: covered(words) };
  }
  if (headline) {
    const h1 = [...document.querySelectorAll("h1")].find((h) => h.checkVisibility?.() !== false && h.innerText.trim().length > 8);
    if (!h1) return { focus: null, marks: [] };
    const range = document.createRange();
    range.selectNodeContents(h1);
    const rects = lines(range);
    if (!rects.length || rects[0].y > 2 * innerHeight) return { focus: null, marks: [] };
    return { focus: union(rects), marks: rects, covered: false, headline: h1.innerText.trim() };
  }
  return { focus: null, marks: [] };
}

// The pieces of a quote to look for, longest first: the brief may cut a quote with
// "..." or add words in [brackets], and may differ in a word, so the first and last
// ten words of each piece are tried too.
function fragmentsOf(quote) {
  if (!quote) return [];
  const pieces = quote
    .split(/\[[^\]]*\]|\.{3}|…/)
    .map((p) => p.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, ""))
    .filter((p) => p.split(/\s+/).length >= 4)
    .sort((a, b) => b.length - a.length);
  const ends = pieces.flatMap((p) => {
    const words = p.split(/\s+/);
    return words.length > 14 ? [words.slice(0, 10).join(" "), words.slice(-10).join(" ")] : [];
  });
  return [...new Set([...pieces, ...ends])];
}

// Whether a page's headline goes with its link: most article links end in the
// headline's words ("…/amazon-warehouses-benefit-local-economies-study-finds/"),
// so at least half of those words should be in it. Links without words pass.
function matchesLink(url, headline) {
  const slug = new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "";
  const words = slug
    .replace(/\.\w+$/, "")
    .split(/[-_]+/)
    .filter((w) => /^[a-z]{4,}$/i.test(w));
  if (words.length < 3) return true;
  const text = headline.toLowerCase();
  return words.filter((w) => text.includes(w.toLowerCase())).length >= words.length / 2;
}

// Captures each request to <dir>/footage/<id>-web.jpg. A request is
// { id, url, date, highlight } for a website scene, or { id, url, date, quote,
// highlight, article: true } for a document. Returns id → { pick } or { error }
// explaining why there's no picture.
export async function captureWebsites(requests, dir) {
  const results = new Map();
  if (!requests.length) return results;
  const browser = await chromium.launch();
  try {
    for (const request of requests) {
      try {
        results.set(request.id, await capture(browser, request, dir));
      } catch (err) {
        results.set(request.id, { error: err.message.split("\n")[0] });
      }
    }
  } finally {
    await browser.close();
  }
  return results;
}

async function capture(browser, { id, url, date, highlight, quote, article = false }, dir) {
  if (/\.pdf($|[?#])/i.test(url)) return { error: "it's a PDF" };
  const copies = await archivedCopies(url, date, article).catch(() => []);
  if (!copies.length && date && !article) return { error: `the Wayback Machine has no copy of ${url} within ${PAST_TOLERANCE_DAYS} days of ${date}` };
  const wanted = { fragments: fragmentsOf(quote), highlight: highlight ?? null, headline: article };
  const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2, locale: "en-US", timezoneId: "America/Los_Angeles" });
  try {
    let chosen = null;
    let lastError = "no copy loaded";
    if (article) {
      // The first copy, or failing those the live page, that shows the quote with
      // nothing on top of it.
      for (const copy of [...copies, null]) {
        const page = await context.newPage();
        const loaded = await load(page, copy?.url ?? url);
        // All the way down first, so whatever loads or collapses on the way has.
        if (!loaded.error) await scrollThrough(page, 0, Math.min(await page.evaluate(() => document.documentElement.scrollHeight), 25 * VIEW.height));
        const found = loaded.error ? loaded : await page.evaluate(locateInPage, wanted);
        const mismatch = !found.error && !quote && !matchesLink(url, `${found.headline ?? ""} ${await page.title()}`);
        if (found.error || found.covered || mismatch) {
          lastError = found.error ?? (mismatch ? "the page's headline doesn't match its link" : "something covers the quote on the page");
          await page.close();
          continue;
        }
        chosen = { page, copy, ...loaded, found };
        break;
      }
    } else {
      // The nearest archived copy whose pictures loaded and that's more than a
      // screen tall; failing that, the best one tried. Live only when the archive
      // has nothing.
      for (const copy of copies) {
        const page = await context.newPage();
        const loaded = await load(page, copy.url);
        if (loaded.error) {
          lastError = loaded.error;
          await page.close();
          continue;
        }
        if (!chosen || loaded.quality > chosen.quality) {
          await chosen?.page.close();
          chosen = { page, copy, ...loaded };
        } else await page.close();
        if (loaded.quality >= 0.9 && loaded.height >= 1.3 * VIEW.height) break;
      }
      if (!chosen && !copies.length) {
        const page = await context.newPage();
        const loaded = await load(page, url);
        if (loaded.error) return { error: loaded.error };
        chosen = { page, copy: null, ...loaded };
      }
      if (chosen) {
        const found = await chosen.page.evaluate(locateInPage, wanted);
        // Words that aren't there just don't get circled.
        chosen.found = found.error || found.covered ? { focus: null, marks: [] } : found;
      }
    }
    if (!chosen) return { error: lastError };
    const { page, copy, found } = chosen;
    const file = `footage/${id}-web.jpg`;
    let shot = await shoot(page, `${dir}/${file}`, found, wanted);
    if (shot.error && article) return { error: shot.error };
    // A website's words that can't be placed just don't get circled.
    if (shot.error) shot = await shoot(page, `${dir}/${file}`, { focus: null, marks: [] }, wanted);
    return {
      pick: {
        id: `web-${id}`,
        kind: "website",
        source: copy ? "Wayback Machine" : "Live page",
        file,
        url,
        pageURL: copy?.pageURL ?? url,
        archived: copy?.date ?? null,
        title: (await page.title()).trim(),
        width: VIEW.width,
        // circle: words on a website; highlight: a quote; underline: a headline.
        mark: quote ? "highlight" : highlight ? "circle" : "underline",
        ...shot,
      },
    };
  } finally {
    await context.close();
  }
}

// How far the page below the first screen moves up once it's scrolled: some
// pages lay out differently then (a big header that shrinks). The first screen
// is taken unscrolled and the rest scrolled, so the picture follows the page as a
// reader sees it, and everything below the first screen is shifted by this much.
async function scrollShift(page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  const before = await page.evaluate((view) => {
    const inFlow = (el) => {
      for (let e = el; e && e !== document.body; e = e.parentElement) if (["fixed", "sticky"].includes(getComputedStyle(e).position)) return false;
      return true;
    };
    for (const y of [view.height - 20, view.height - 120, view.height - 240]) {
      for (const x of [view.width / 2, view.width / 4, (3 * view.width) / 4]) {
        const el = document.elementFromPoint(x, y);
        if (el && el !== document.body && el !== document.documentElement && inFlow(el)) {
          window.__anchor = el;
          return el.getBoundingClientRect().top + window.scrollY;
        }
      }
    }
    return null;
  }, VIEW);
  if (before === null) return 0;
  await page.evaluate((y) => window.scrollTo(0, y), VIEW.height);
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => (window.__anchor?.isConnected ? window.__anchor.getBoundingClientRect().top + window.scrollY : null));
  await page.evaluate(() => window.scrollTo(0, 0));
  return after === null ? 0 : Math.round(before - after);
}

// Saves the picture: the page from the top down to a little past the words, or,
// when they're far down, the top of the page and the stretch around them, with a
// cut between. Returns { height, focus, marks } in the picture's pixels.
async function shoot(page, path, found, wanted) {
  const screen = VIEW.height;
  const shift = await scrollShift(page);
  const pageHeight = () => page.evaluate(() => document.documentElement.scrollHeight);
  // Unscrolled, which is how tall the picture of the whole page would be.
  const fullHeight = await pageHeight();
  // Where the words are in the picture: measured unscrolled when they're on the
  // first screen, otherwise scrolled to them, as they'll be taken.
  const measure = async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    const unscrolled = await page.evaluate(locateInPage, wanted);
    if (unscrolled.error || !unscrolled.focus || unscrolled.focus.y + unscrolled.focus.height <= screen) return unscrolled;
    await page.evaluate((y) => window.scrollTo(0, y), Math.max(screen, unscrolled.focus.y - shift - screen / 2));
    await page.waitForTimeout(400);
    const scrolled = await page.evaluate(locateInPage, wanted);
    if (scrolled.error || !scrolled.focus) return unscrolled;
    const moved = (r) => ({ ...r, y: r.y + shift });
    return { ...scrolled, focus: moved(scrolled.focus), marks: scrolled.marks.map(moved) };
  };
  let { focus, marks } = found.focus ? await measure() : found;
  if (!focus) ({ focus, marks } = found);
  // Taken again if the words have moved by the time the screenshots are done
  // (pictures loading, or something collapsing, above them).
  const settled = async () => {
    if (!focus) return true;
    const again = await measure();
    if (again.error || !again.focus) return true;
    const still = Math.abs(again.focus.y - focus.y) < 2;
    ({ focus, marks } = again);
    return still;
  };
  if (!focus || focus.y + focus.height <= DEEP_SCREENS * screen) {
    for (let tries = 0; ; tries++) {
      const shown = Math.round(Math.min(fullHeight, Math.max(MAX_SCREENS * screen, focus ? focus.y + focus.height + screen / 2 : 0), 6 * screen));
      const parts = await grab(page, 0, shown, shift);
      if ((await settled()) || tries === 2) {
        await stitch(page, path, parts);
        if (focus && !(await sameWords(page, path, focus, focus, shift))) return { error: "the page moved while it was being captured" };
        return { height: shown, focus, marks };
      }
    }
  }
  const top = Math.round(screen * 0.95);
  const around = () => [Math.max(top, Math.round(focus.y - 0.8 * screen)), Math.round(Math.min(fullHeight, focus.y + focus.height + 0.8 * screen))];
  for (let tries = 0; tries < 4; tries++) {
    const [from, to] = around();
    await scrollThrough(page, from - shift, to - shift);
    if (await settled()) break;
  }
  for (let tries = 0; ; tries++) {
    const [from, to] = around();
    const parts = [...(await grab(page, 0, top, shift)), { cut: true, height: CUT_HEIGHT }, ...(await grab(page, from, to, shift))];
    if ((await settled()) || tries === 2) {
      await stitch(page, path, parts);
      const moved = (r) => ({ ...r, y: r.y - from + top + CUT_HEIGHT });
      if (!(await sameWords(page, path, focus, moved(focus), shift))) return { error: "the page moved while it was being captured" };
      return { height: top + CUT_HEIGHT + (to - from), focus: moved(focus), marks: marks.map(moved) };
    }
  }
}

// Whether the picture shows the words where they were found: the spot is
// compared with a fresh screenshot of the words on the page (ffmpeg's SSIM), so
// a page that shifted while it was taken never gets the wrong line marked.
async function sameWords(page, path, onPage, inPicture, shift) {
  const unscrolled = onPage.y + onPage.height <= VIEW.height;
  const y = unscrolled ? onPage.y : onPage.y - shift;
  await page.evaluate((top) => window.scrollTo(0, top), unscrolled ? 0 : Math.max(VIEW.height, y - VIEW.height / 2));
  await page.waitForTimeout(400);
  const scrolled = await page.evaluate(() => window.scrollY);
  const x = Math.max(0, Math.floor(onPage.x - 8));
  const box = { x, y: Math.floor(y - scrolled - 6), width: Math.min(Math.ceil(onPage.width + 16), VIEW.width - x), height: Math.min(Math.ceil(onPage.height + 12), 400) };
  const live = box.y >= 0 && box.y + box.height <= VIEW.height ? await page.screenshot({ type: "png", clip: box }) : null;
  await page.evaluate(() => window.scrollTo(0, 0));
  if (!live) return true;
  const tmp = mkdtempSync(join(tmpdir(), "page-"));
  try {
    writeFileSync(join(tmp, "live.png"), live);
    const crop = `crop=${box.width * 2}:${box.height * 2}:${x * 2}:${Math.floor(inPicture.y - 6) * 2}`;
    const { stderr } = spawnSync("ffmpeg", ["-v", "info", "-nostats", "-i", path, "-i", join(tmp, "live.png"), "-lavfi", `[0:v]${crop},format=gray[a];[1:v]format=gray[b];[a][b]ssim`, "-f", "null", "-"], {
      encoding: "utf8",
    });
    const score = stderr.match(/All:([\d.]+)/)?.[1];
    return score === undefined || Number(score) >= 0.75;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// The picture from y0 to y1, a screen at a time, as the page sits in the browser
// window: a screenshot of the whole page at once lays some pages out differently,
// so the words wouldn't be where they were found. The first screen is taken
// unscrolled and the rest scrolled (`shift`: see scrollShift). Below the top,
// headers and banners that follow the reader down are hidden, so they appear
// once, as in a screenshot of the whole page. Returns [{ data, height }].
async function grab(page, y0, y1, shift) {
  const parts = [];
  for (let y = y0; y < y1; y += VIEW.height) {
    const height = Math.min(VIEW.height, y1 - y);
    const at = y === 0 ? 0 : y - shift;
    await page.evaluate((top) => window.scrollTo(0, top), at);
    if (y > 0) {
      await page.evaluate(() => {
        window.__hidden ??= [];
        for (const el of document.querySelectorAll("body *")) {
          if (!["fixed", "sticky"].includes(getComputedStyle(el).position)) continue;
          el.style.setProperty("visibility", "hidden", "important");
          window.__hidden.push(el);
        }
      });
    }
    await page.waitForTimeout(400);
    const scrolled = await page.evaluate(() => window.scrollY);
    const data = await page.screenshot({ type: "png", clip: { x: 0, y: at - scrolled, width: VIEW.width, height } });
    parts.push({ data: data.toString("base64"), height });
  }
  await page.evaluate(() => {
    for (const el of window.__hidden ?? []) el.style.removeProperty("visibility");
    window.__hidden = [];
    window.scrollTo(0, 0);
  });
  return parts;
}

// Lays the screenshots one under another, with a marked cut where the page skips
// ahead, and saves them as one picture.
async function stitch(page, path, parts) {
  const dot = `<i style="width:9px;height:9px;border-radius:5px;background:#A8A397;display:block"></i>`;
  const html = parts
    .map((p) =>
      p.cut
        ? `<div style="height:${p.height}px;box-sizing:border-box;background:#ECE9E2;border-top:1px solid #D3CEC2;border-bottom:1px solid #D3CEC2;display:flex;align-items:center;justify-content:center;gap:14px">${dot}${dot}${dot}</div>`
        : `<img src="data:image/png;base64,${p.data}" style="display:block;width:${VIEW.width}px;height:${p.height}px">`,
    )
    .join("");
  const sheet = await page.context().newPage();
  try {
    await sheet.setContent(`<body style="margin:0;background:#fff">${html}</body>`);
    await sheet.screenshot({ path, type: "jpeg", quality: 88, fullPage: true });
  } finally {
    await sheet.close();
  }
}
