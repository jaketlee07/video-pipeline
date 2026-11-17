import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { BOTTOM_SPACE, colors, fonts } from "../theme.js";
import { Mark, seedOf, strokePath } from "./Scribble.jsx";

const KIND_LABEL = {
  news: "News report",
  court: "Court record",
  filing: "Company filing",
  statement: "Statement",
  study: "Research",
  law: "Law",
  deed: "Deed record",
  letter: "Letter",
};

const sizeFor = (text, sizes) => sizes.find(([max]) => text.length <= max)?.[1] ?? sizes.at(-1)[1];

// The site a source link points to, like "wbrc.com".
function domain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// The desk the papers lie on: dark slate with a faint cutting-mat grid and grain.
function Desk({ children }) {
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 40%, #1E2A40 0%, ${colors.background} 80%)` }}>
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(rgba(151, 163, 182, 0.07) 2px, transparent 2px), linear-gradient(90deg, rgba(151, 163, 182, 0.07) 2px, transparent 2px)`,
          backgroundSize: "96px 96px",
          backgroundPosition: "-20px -30px",
        }}
      />
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, opacity: 0.18 }}>
        <filter id="grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" />
          <feColorMatrix values="0 0 0 0 0.6  0 0 0 0 0.65  0 0 0 0 0.75  0 0 0 0.9 0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#grain)" />
      </svg>
      {children}
    </AbsoluteFill>
  );
}

// Words swept by a highlighter: a rough, slightly crooked band drawn behind them.
// Long phrases, which would wrap, get a plain sweep instead.
function Highlighted({ text, sweep, seed }) {
  if (text.length > 44) {
    return (
      <span
        style={{
          fontWeight: 600,
          backgroundImage: `linear-gradient(${colors.marker}, ${colors.marker})`,
          backgroundRepeat: "no-repeat",
          backgroundSize: `${sweep * 100}% 100%`,
          boxDecorationBreak: "clone",
          WebkitBoxDecorationBreak: "clone",
        }}
      >
        {text}
      </span>
    );
  }
  return (
    <span style={{ position: "relative", display: "inline-block", fontWeight: 600, isolation: "isolate" }}>
      <svg viewBox="0 0 100 20" preserveAspectRatio="none" style={{ position: "absolute", left: 0, top: "18%", height: "78%", width: "100%", zIndex: -1, overflow: "visible" }}>
        <Mark d={strokePath(0, 100, 9, seed)} progress={sweep} color={colors.marker} width={15} cap="butt" />
        <Mark d={strokePath(1, 99, 11, seed + 1)} progress={sweep * 1.1 - 0.1} color={colors.marker} width={9} opacity={0.6} cap="butt" />
      </svg>
      {text}
    </span>
  );
}

// The quote, with its key words highlighted.
function Quote({ text, highlight, sweep, seed }) {
  const at = highlight ? text.toLowerCase().indexOf(highlight.toLowerCase()) : -1;
  const style = { fontFamily: fonts.serif, fontWeight: 400, fontSize: sizeFor(text, [[110, 50], [190, 44], [999, 38]]), lineHeight: 1.45, color: colors.ink };
  if (at === -1) return <div style={style}>“{text}”</div>;
  return (
    <div style={style}>
      “{text.slice(0, at)}
      <Highlighted text={text.slice(at, at + highlight.length)} sweep={sweep} seed={seed} />
      {text.slice(at + highlight.length)}”
    </div>
  );
}

// A source on screen, as a sheet of paper taped to the desk: what kind of
// document, who published it and when, what it records, and the exact words
// quoted from it.
export function Document({ document: doc }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const seed = seedOf(doc.heading);
  const tilt = ((seed % 100) / 100 - 0.5) * 2.4;
  const enter = spring({ frame, fps, config: { damping: 18, mass: 0.8 } });
  const sweep = interpolate(frame, [0.9 * fps, 1.6 * fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const push = interpolate(frame, [0, durationInFrames], [1, 1.035]);
  const site = doc.url ? domain(doc.url) : null;
  const meta = [doc.source, doc.date].filter(Boolean).join(" · ");
  const headingSize = doc.quote ? sizeFor(doc.heading, [[50, 50], [90, 42], [999, 36]]) : sizeFor(doc.heading, [[50, 72], [90, 60], [999, 50]]);

  return (
    <Desk>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingBottom: BOTTOM_SPACE - 40 }}>
        <div
          style={{
            position: "relative",
            width: 1260,
            opacity: Math.min(1, enter),
            transform: `translateY(${interpolate(enter, [0, 1], [90, 0])}px) rotate(${tilt + interpolate(enter, [0, 1], [-2, 0])}deg) scale(${push})`,
          }}
        >
          {/* Another sheet underneath, slightly askew. */}
          <div style={{ position: "absolute", inset: 0, borderRadius: 10, background: "#DCD6C8", transform: "rotate(2.4deg) translate(18px, 10px)", boxShadow: "0 20px 50px rgba(0, 0, 0, 0.45)" }} />
          <div style={{ position: "relative", boxSizing: "border-box", padding: "52px 68px 44px", borderRadius: 10, background: colors.paper, boxShadow: "0 30px 80px rgba(0, 0, 0, 0.55)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
              <div
                style={{
                  padding: "6px 16px",
                  borderRadius: 6,
                  background: colors.ink,
                  color: colors.paper,
                  fontFamily: fonts.body,
                  fontWeight: 700,
                  fontSize: 22,
                  letterSpacing: 3,
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                }}
              >
                {KIND_LABEL[doc.kind] ?? "Document"}
              </div>
              <div style={{ fontFamily: fonts.body, fontWeight: 600, fontSize: 26, color: colors.inkMuted }}>{meta}</div>
            </div>
            <div style={{ height: 2, background: "rgba(27, 34, 51, 0.18)", margin: "26px 0 28px" }} />
            <div style={{ position: "relative", fontFamily: fonts.serif, fontWeight: 700, fontSize: headingSize, lineHeight: 1.2, color: colors.ink }}>
              {doc.heading}
              {/* Without a quote, the heading gets a pen underline. */}
              {!doc.quote && (
                <svg width="100%" height={30} viewBox="0 0 1000 30" preserveAspectRatio="none" style={{ position: "absolute", left: 0, bottom: -26, overflow: "visible" }}>
                  {/* As long as the heading's last line, estimated: the full width once it wraps. */}
                  <Mark d={strokePath(0, Math.min(1000, (doc.heading.length * headingSize * 0.5 * 1000) / 1124), 12, seed)} progress={sweep} color={colors.accent} width={7} />
                </svg>
              )}
            </div>
            {doc.quote && (
              <div style={{ marginTop: 26 }}>
                <Quote text={doc.quote} highlight={doc.highlight} sweep={sweep} seed={seed} />
                {doc.speaker && <div style={{ marginTop: 18, fontFamily: fonts.body, fontWeight: 600, fontSize: 28, color: colors.inkMuted }}>— {doc.speaker}</div>}
              </div>
            )}
            {site && <div style={{ marginTop: 30, fontFamily: fonts.mono, fontWeight: 500, fontSize: 22, color: colors.inkMuted }}>{site}</div>}
          </div>
          {/* A strip of tape holding it down. */}
          <div
            style={{
              position: "absolute",
              top: -22,
              left: "50%",
              width: 190,
              height: 46,
              transform: `translateX(-50%) rotate(${-3 - tilt}deg)`,
              background: "rgba(236, 228, 205, 0.72)",
              boxShadow: "0 2px 6px rgba(0, 0, 0, 0.18)",
              clipPath: "polygon(2% 8%, 98% 0%, 100% 30%, 97% 62%, 100% 100%, 3% 94%, 0% 66%, 3% 34%)",
            }}
          />
        </div>
      </AbsoluteFill>
    </Desk>
  );
}
