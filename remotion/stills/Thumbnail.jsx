import { AbsoluteFill, Img, staticFile } from "remotion";
import { colors, fonts } from "../theme.js";
import { Mark, loopPath, seedOf } from "../scenes/Scribble.jsx";

const W = 1280;
const H = 720;

// Words this long or shorter (the longest line, in characters) get this size.
const SIZES = [
  [7, 200],
  [9, 172],
  [11, 148],
  [14, 122],
  [99, 100],
];

// A video's thumbnail: a few big words over a real photo of the place, darkened on
// the words' side. The photo is placed so `image.focus` (a point in its pixels)
// lands at `image.at` (a point on the thumbnail), at `image.scale` thumbnail
// pixels per image pixel. With `image.circle` (radii in image pixels), the
// focus gets a pen loop, as the videos circle a site. Rendered by src/package.mjs.
export function Thumbnail({ image, lines, accent = "", side = "left" }) {
  const { src, width, height, focus, at, scale, circle } = image;
  const left = at[0] - focus[0] * scale;
  const top = at[1] - focus[1] * scale;
  const longest = Math.max(...lines.map((l) => l.length));
  const size = SIZES.find(([max]) => longest <= max)[1];
  // Words compare without punctuation around them ("WALMART." matches "Walmart").
  const bare = (word) => word.toUpperCase().replace(/^[^\p{L}\p{N}$]+|[^\p{L}\p{N}%]+$/gu, "");
  const accents = new Set(accent.split(/\s+/).map(bare).filter(Boolean));
  const shade = `linear-gradient(to ${side === "left" ? "right" : "left"}, ${colors.background}F2 0%, ${colors.background}C8 38%, ${colors.background}00 68%)`;
  return (
    <AbsoluteFill style={{ backgroundColor: colors.background, overflow: "hidden" }}>
      <Img src={staticFile(src)} style={{ position: "absolute", left, top, width: width * scale, height: height * scale, filter: "contrast(1.08) saturate(1.12)" }} />
      <AbsoluteFill style={{ background: shade }} />
      {circle && (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute" }}>
          <Mark d={loopPath(at[0], at[1], circle[0] * scale, circle[1] * scale, seedOf(src))} progress={1} color={colors.accent} width={11} />
        </svg>
      )}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: side === "left" ? "flex-start" : "flex-end", padding: "0 56px" }}>
        <div
          style={{
            fontFamily: fonts.display,
            fontWeight: 800,
            fontSize: size,
            lineHeight: 0.92,
            letterSpacing: 1,
            textAlign: side,
            color: colors.text,
            textShadow: "0 4px 18px rgba(0, 0, 0, 0.55)",
            maxWidth: W * 0.62,
          }}
        >
          {lines.map((line, i) => (
            <div key={i}>
              {line
                .toUpperCase()
                .split(" ")
                .map((word, j) => (
                  <span key={j} style={{ color: accents.has(bare(word)) ? colors.accent : undefined }}>
                    {j ? " " : ""}
                    {word}
                  </span>
                ))}
            </div>
          ))}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
