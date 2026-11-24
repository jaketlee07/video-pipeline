import { AbsoluteFill, Img, staticFile } from "remotion";
import { colors, fonts } from "../theme.js";
import { Mark, loopPath, seedOf } from "../scenes/Scribble.jsx";

const W = 1280;
const H = 720;
// The split between two pictures leans this far, top to bottom.
const LEAN = 70;
// The display font's capitals average a little under half the type size across,
// its digits and symbols about half.
const fit = (text, width, biggest, em = 0.48) => Math.min(biggest, Math.floor(width / (Math.max(1, text.length) * em)));
// "33-40%" reads as a range: an en dash between numbers.
const dashed = (text) => text.replace(/(\d)\s*-\s*(\d)/g, "$1–$2");
const shadow = "0 6px 26px rgba(0, 0, 0, 0.75), 0 2px 6px rgba(0, 0, 0, 0.6)";
// Words compare without punctuation around them ("WALMART." matches "Walmart").
const bare = (word) => word.toUpperCase().replace(/^[^\p{L}\p{N}$<]+|[^\p{L}\p{N}%]+$/gu, "");

// A video's thumbnail, made to say what the video is about at a glance: a headline
// naming the subject across the top, a bright photo filling the frame (or two side
// by side, to set one thing against another), and a callout on it: a number tag,
// or a receipt with one line circled. Each picture is placed so `image.focus` (a
// point in its pixels) lands at `image.at` on the thumbnail, at `image.scale`
// thumbnail pixels per image pixel; `image.circle` (radii in image pixels) gets a
// pen loop, as the videos circle a site. Laid out by src/package.mjs.
export function Thumbnail({ kicker = "", headline = "", accent = "", panels = [], receipt = null }) {
  const accents = new Set(accent.split(/\s+/).map(bare).filter(Boolean));
  const size = fit(headline, W - 120, 132);
  return (
    <AbsoluteFill style={{ backgroundColor: colors.background, overflow: "hidden" }}>
      {panels.map((p, i) => (
        <Panel key={i} {...p} />
      ))}
      {panels.length === 2 && (
        <svg width={W} height={H} style={{ position: "absolute" }}>
          <line x1={W / 2 + LEAN / 2} y1={-10} x2={W / 2 - LEAN / 2} y2={H + 10} stroke={colors.text} strokeWidth={10} />
        </svg>
      )}
      {/* Darker behind the headline only; the rest of the picture stays bright. */}
      <AbsoluteFill style={{ background: "linear-gradient(to bottom, rgba(8, 11, 18, 0.78) 0%, rgba(8, 11, 18, 0.45) 22%, rgba(8, 11, 18, 0) 40%)" }} />
      <div style={{ position: "absolute", top: 22, left: 0, width: W, textAlign: "center", color: colors.text, textShadow: shadow }}>
        {kicker && <div style={{ fontFamily: fonts.display, fontWeight: 600, fontSize: 46, letterSpacing: 8, lineHeight: 1.05 }}>{kicker.toUpperCase()}</div>}
        <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: size, lineHeight: 0.98, letterSpacing: 1 }}>
          {headline
            .toUpperCase()
            .split(" ")
            .map((word, j) => (
              <span key={j} style={{ color: accents.has(bare(word)) ? colors.accent : undefined }}>
                {j ? " " : ""}
                {word}
              </span>
            ))}
        </div>
      </div>
      {panels.map((p, i) => p.label && <Label key={i} {...p.label} />)}
      {receipt && <Receipt {...receipt} />}
    </AbsoluteFill>
  );
}

function Panel({ image, clip }) {
  const { src, width, height, focus, at, scale, circle } = image;
  const left = at[0] - focus[0] * scale;
  const top = at[1] - focus[1] * scale;
  const shape = {
    left: `polygon(0 0, ${W / 2 + LEAN / 2}px 0, ${W / 2 - LEAN / 2}px 100%, 0 100%)`,
    right: `polygon(${W / 2 + LEAN / 2}px 0, 100% 0, 100% 100%, ${W / 2 - LEAN / 2}px 100%)`,
  }[clip];
  return (
    <AbsoluteFill style={{ clipPath: shape }}>
      <Img src={staticFile(src)} style={{ position: "absolute", left, top, width: width * scale, height: height * scale, filter: "contrast(1.1) saturate(1.3) brightness(1.04)" }} />
      {circle && (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute" }}>
          <Mark d={loopPath(at[0], at[1], circle[0] * scale, circle[1] * scale, seedOf(src))} progress={1} color={colors.accent} width={12} />
        </svg>
      )}
    </AbsoluteFill>
  );
}

// A tag on the picture: a big number or word on a solid block, with a short line
// under it saying what it is.
const TONES = {
  amber: { background: colors.accent, color: colors.ink },
  red: { background: colors.danger, color: "#FFFFFF" },
  light: { background: colors.paper, color: colors.ink },
};
function Label({ big, small, tone = "amber", at, width }) {
  const look = TONES[tone] ?? TONES.amber;
  const bigSize = fit(big, width - 48, 116, 0.5);
  const smallSize = fit(small, width - 32, 40);
  return (
    <div style={{ position: "absolute", left: at[0] - width / 2, top: at[1], width, display: "flex", flexDirection: "column", alignItems: "center", filter: "drop-shadow(0 8px 18px rgba(0, 0, 0, 0.55))" }}>
      <div style={{ ...look, fontFamily: fonts.display, fontWeight: 800, fontSize: bigSize, lineHeight: 1, padding: "8px 22px 4px", letterSpacing: 1, whiteSpace: "nowrap" }}>{dashed(big).toUpperCase()}</div>
      {small && (
        <div style={{ background: colors.ink, color: colors.text, fontFamily: fonts.display, fontWeight: 800, fontSize: smallSize, lineHeight: 1, padding: "8px 14px 6px", letterSpacing: 1.5, marginTop: -2, whiteSpace: "nowrap" }}>
          {small.toUpperCase()}
        </div>
      )}
    </div>
  );
}

// A paper receipt, tilted, with one line that matters circled in pen and the rest
// left as blurred placeholder lines, so it reads at a glance as "this line is the
// big one".
function Receipt({ title, item, value, stamp, at }) {
  const [w, h] = [480, 490];
  const pad = 34;
  const teeth = 11;
  const edge = Array.from({ length: teeth * 2 + 1 }, (_, i) => `${100 - (i * 100) / (teeth * 2)}% ${i % 2 ? "100%" : "calc(100% - 20px)"}`).join(", ");
  const bar = (bw, bh = 15) => <div style={{ width: bw, height: bh, borderRadius: bh / 2, background: colors.inkMuted, opacity: 0.5 }} />;
  // The item and its value share one row; the value, the one that matters, gets
  // the room.
  const itemSize = fit(item, 160, 50);
  const itemWidth = item.length * itemSize * 0.48;
  const shown = dashed(value);
  const valueSize = fit(shown, w - pad * 2 - itemWidth - 40, 84, 0.56);
  return (
    <div style={{ position: "absolute", left: at[0] - w / 2, top: at[1] - h / 2, width: w, height: h, transform: "rotate(-5deg)", filter: "drop-shadow(0 18px 28px rgba(0, 0, 0, 0.6))" }}>
      <div style={{ position: "absolute", inset: 0, background: colors.paper, clipPath: `polygon(0 0, 100% 0, ${edge}, 0 calc(100% - 20px))`, padding: `30px ${pad}px` }}>
        <div style={{ fontFamily: fonts.mono, fontWeight: 500, fontSize: 32, color: colors.ink, textAlign: "center", letterSpacing: 2 }}>{title.toUpperCase()}</div>
        <div style={{ borderTop: `4px dashed ${colors.inkMuted}`, opacity: 0.5, margin: "16px 0 24px" }} />
        {[170, 130].map((bw, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
            {bar(bw)}
            {bar(70)}
          </div>
        ))}
        <div style={{ borderTop: `4px solid ${colors.inkMuted}`, opacity: 0.45, margin: "4px 0 22px" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: fonts.display, fontWeight: 800, color: colors.ink, whiteSpace: "nowrap" }}>
          <span style={{ fontSize: itemSize }}>{item.toUpperCase()}</span>
          <span style={{ fontSize: valueSize, lineHeight: 1, position: "relative", display: "inline-block" }}>
            {shown}
            {/* The loop stretches to the value's own box, whatever its width. */}
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", left: "-9%", top: "-32%", width: "118%", height: "164%", overflow: "visible" }}>
              <path d={loopPath(50, 50, 46, 42, seedOf(value))} fill="none" stroke={colors.accent} strokeWidth={11} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            </svg>
          </span>
        </div>
      </div>
      {stamp && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: 52,
            transform: "translateX(-50%) rotate(-9deg)",
            border: `7px solid ${colors.danger}`,
            borderRadius: 10,
            color: colors.danger,
            fontFamily: fonts.display,
            fontWeight: 800,
            fontSize: 60,
            lineHeight: 1,
            padding: "8px 22px 2px",
            letterSpacing: 5,
            opacity: 0.92,
            whiteSpace: "nowrap",
          }}
        >
          {stamp.toUpperCase()}
        </div>
      )}
    </div>
  );
}
