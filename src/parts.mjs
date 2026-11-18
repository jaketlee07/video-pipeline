// The script's parts (Hook, Setup, each chapter...) in order, with when each is
// spoken. Used for the music's moods and the description's chapters.
export function partsOf(plan, timing) {
  const time = new Map(timing.sentences.map((s) => [s.id, s]));
  const parts = [];
  for (const s of plan.sentences) {
    if (parts.at(-1)?.name === s.part) parts.at(-1).sentences.push(s);
    else parts.push({ name: s.part, sentences: [s] });
  }
  return parts.map((p) => ({
    name: p.name,
    text: p.sentences.map((s) => s.text).join(" "),
    start: time.get(p.sentences[0].id).start,
    end: time.get(p.sentences.at(-1).id).end,
  }));
}

// 75.4 → "1:15".
export const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
