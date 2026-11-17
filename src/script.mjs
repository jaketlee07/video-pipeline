// Turns the "## Script" section of a video's Notion page into narration.
// ### headings name the parts, "> " lines are notes for Jake, and every other
// line is a paragraph the narrator reads. A paragraph starting with [pause] or
// [long pause] gets a beat of silence before it.
import { unescapeMarkdown } from "./notion.mjs";

// Markdown to plain spoken text: keep link text, drop emphasis and escapes.
function spoken(line) {
  return unescapeMarkdown(
    line
      .replace(/^([-*+]|\d+\.)\s+/, "")
      .replace(/(?<!\\)\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/(?<![\w\\])([*_])(.+?)\1(?!\w)/g, "$2"),
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function parseScript(scriptMarkdown) {
  const paragraphs = [];
  let part = "Intro";
  let pending = null;
  for (const raw of scriptMarkdown.split("\n")) {
    const line = raw.trim();
    // Skip blanks, notes, and Notion's own tags such as <empty-block/>.
    if (!line || line.startsWith(">") || /^<[^>]+\/>$/.test(line)) continue;
    if (/^#{1,6}\s/.test(line)) {
      part = spoken(line.replace(/^#+\s*/, ""));
      continue;
    }
    const text = spoken(line);
    const beat = text.match(BEAT)?.[1].toLowerCase() ?? pending;
    pending = null;
    // A marker on a line of its own applies to the next paragraph.
    if (!text.replace(BEAT, "")) {
      pending = beat;
      continue;
    }
    paragraphs.push({ part, text: text.replace(BEAT, ""), raw: line, beat });
  }
  return paragraphs;
}

// The beat marker at the start of a paragraph, as Jake sees it in Notion.
export const BEAT = /^\[(pause|long pause)\]\s*/i;

// Paragraphs with [bracketed notes], which the narrator would read aloud.
export const bracketNotes = (paragraphs) => paragraphs.filter((p) => /\[[^\]]*\]/.test(p.text));

// The segmenter treats "Dr." or "U.S." as a sentence end; pieces ending like this get rejoined.
const ABBREVIATION = /\b(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|vs|Inc|Co|Corp|Ltd|Mt|Ft|No|[A-Z])\.$/;

export function splitSentences(paragraphs) {
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  const sentences = [];
  for (const [paragraph, { part, text }] of paragraphs.entries()) {
    const pieces = [];
    for (const { segment } of segmenter.segment(text)) {
      const piece = segment.trim();
      if (!piece) continue;
      if (pieces.length && ABBREVIATION.test(pieces.at(-1))) pieces[pieces.length - 1] += ` ${piece}`;
      else pieces.push(piece);
    }
    for (const sentence of pieces) {
      sentences.push({ id: sentences.length + 1, part, paragraph, text: sentence, words: wordCount(sentence) });
    }
  }
  return sentences;
}

export const wordCount = (text) => text.split(/\s+/).filter(Boolean).length;

// Makes scenes ({ first, last } sentence numbers) cover sentences 1..count exactly
// once and in order, moving any boundaries that are off. Returns how many moved.
export function fitToSentences(scenes, count) {
  const fitted = [];
  let next = 1;
  let repaired = 0;
  for (const scene of [...scenes].sort((a, b) => a.first - b.first)) {
    if (next > count) {
      repaired++;
      continue;
    }
    const last = Math.min(Math.max(scene.last, next), count);
    if (scene.first !== next || scene.last !== last) repaired++;
    fitted.push({ ...scene, first: next, last });
    next = last + 1;
  }
  if (!fitted.length) throw new Error("Claude returned no scenes.");
  if (next <= count) {
    fitted.at(-1).last = count;
    repaired++;
  }
  return { scenes: fitted, repaired };
}

// Narrator pace once sped up in the voice step (SPEED): about 170 words a minute.
export const WORDS_PER_SECOND = 2.83;
