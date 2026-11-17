import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { BOTTOM_SPACE, colors, fonts } from "../theme.js";
import { Backdrop } from "./Backdrop.jsx";
import { Mark, seedOf, strokePath } from "./Scribble.jsx";

const sizeFor = (text, sizes) => sizes.find(([max]) => text.length <= max)?.[1] ?? sizes.at(-1)[1];

// Words rise in one after another.
function Words({ text, style, delay = 0 }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={style}>
      {text.split(" ").map((word, i) => {
        const p = spring({ frame: frame - delay - i * 2, fps, config: { damping: 200 } });
        return (
          <span key={i} style={{ display: "inline-block", opacity: p, transform: `translateY(${interpolate(p, [0, 1], [30, 0])}px)` }}>
            {word}&nbsp;
          </span>
        );
      })}
    </div>
  );
}

// Section openers, key lines, quotes, and the question for viewers. After a shot,
// the words go over that shot, darkened.
export function TitleCard({ title, backdrop, seed }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const bar = spring({ frame, fps, config: { damping: 200 } });
  const tagIn = spring({ frame: frame - 20, fps, config: { damping: 200 } });
  const { style, text, attribution } = title;
  const block = { maxWidth: 1500, textAlign: "center", color: colors.text };

  let content;
  if (style === "quote") {
    content = (
      <>
        <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 200, lineHeight: 0.6, color: colors.accent, opacity: bar }}>“</div>
        <Words text={text} style={{ ...block, fontFamily: fonts.body, fontWeight: 600, fontSize: sizeFor(text, [[70, 64], [140, 54], [999, 46]]), lineHeight: 1.3 }} />
        {attribution && (
          <div style={{ marginTop: 36, fontFamily: fonts.body, fontWeight: 500, fontSize: 36, color: colors.muted, opacity: tagIn }}>— {attribution}</div>
        )}
      </>
    );
  } else {
    const section = style === "section";
    content = (
      <>
        <svg width={200} height={30} style={{ marginBottom: 30, overflow: "visible" }}>
          <Mark d={strokePath(10, 190, 14, seedOf(text))} progress={bar} color={colors.accent} width={10} />
        </svg>
        <Words
          text={section ? text.toUpperCase() : text}
          style={{
            ...block,
            fontFamily: fonts.display,
            fontWeight: section ? 800 : 600,
            fontSize: sizeFor(text, section ? [[24, 150], [40, 120], [999, 96]] : [[30, 120], [60, 96], [100, 78], [999, 64]]),
            lineHeight: 1.1,
            letterSpacing: section ? 2 : 0,
          }}
        />
        {style === "question" && (
          <div
            style={{
              marginTop: 44,
              padding: "10px 26px",
              borderRadius: 999,
              border: `3px solid ${colors.accent}`,
              fontFamily: fonts.body,
              fontWeight: 700,
              fontSize: 30,
              letterSpacing: 3,
              color: colors.accent,
              opacity: tagIn,
            }}
          >
            TELL US IN THE COMMENTS
          </div>
        )}
      </>
    );
  }
  return (
    <Backdrop media={backdrop} seed={seed}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingBottom: BOTTOM_SPACE - 60 }}>{content}</AbsoluteFill>
    </Backdrop>
  );
}
