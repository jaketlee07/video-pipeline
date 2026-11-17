import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts } from "./theme.js";

// A word as it shows in burned-in captions: no commas, full stops or quotation
// marks around it, the way short-form captions are usually styled. Question and
// exclamation marks stay, as do apostrophes, decimals and $ or %.
const bare = (word) => {
  const unquoted = word.replace(/^["“‘'(]+/, "").replace(/["”’')]+$/, "");
  // Initials like "U.S." keep their last full stop.
  return /^(?:[A-Z]\.)+$/.test(unquoted) ? unquoted : unquoted.replace(/[.,;:…]+$/, "").replace(/^[—–-]+$/, "");
};

// One caption line at a time, from the narrator's word timings. Words light up as
// they're spoken. For Shorts; long videos use YouTube's closed captions instead.
export function Captions({ lines }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const line = lines.find((l) => t >= l.start && t < l.end);
  if (!line) return null;
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 72 }}>
      <div
        style={{
          maxWidth: 1560,
          padding: "12px 28px",
          borderRadius: 14,
          background: "rgba(8, 12, 20, 0.62)",
          fontFamily: fonts.body,
          fontWeight: 700,
          fontSize: 50,
          lineHeight: 1.25,
          textAlign: "center",
        }}
      >
        {line.words.filter((w) => bare(w.text)).map((w, i, shown) => {
          const spoken = t >= w.start;
          const current = spoken && (i === shown.length - 1 || t < shown[i + 1].start);
          return (
            <span key={i} style={{ color: current ? colors.accent : spoken ? colors.text : "rgba(243, 239, 230, 0.5)" }}>
              {i ? " " : ""}
              {bare(w.text)}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}
