import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { BOTTOM_SPACE, colors, fonts } from "../theme.js";
import { Desk } from "./Document.jsx";
import { Mark, loopPath, seedOf, strokePath } from "./Scribble.jsx";

const WINDOW = { width: 1560, top: 64 };
const BAR = 62;
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" };
const ease = Easing.inOut(Easing.cubic);
// Where the marked words end up once the camera has pushed in on them.
const FOCUS_AT = [960, 470];
// A highlighter on white paper: laid over the page with multiply, so the text stays black.
const HIGHLIGHTER = "rgba(255, 190, 50, 0.75)";

// "amazon.com" or "sec.gov/cgi-bin/…", for the address bar.
function shortURL(url) {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname;
    const text = `${u.hostname.replace(/^www\./, "")}${path}`;
    return text.length > 72 ? `${text.slice(0, 71)}…` : text;
  } catch {
    return url;
  }
}

const monthYear = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

function Lock() {
  return (
    <svg width={18} height={22} viewBox="0 0 18 22">
      <rect x={1} y={9} width={16} height={12} rx={3} fill={colors.inkMuted} />
      <path d="M4.5 9V6.5a4.5 4.5 0 0 1 9 0V9" fill="none" stroke={colors.inkMuted} strokeWidth={2.4} />
    </svg>
  );
}

// The marks on the page, in its pixels: a highlighter over each line of a quote,
// a pen underline under each line of a headline, or a pen circle around a few
// words. The lines are marked one after another as `progress` goes from 0 to the
// number of lines.
function Marks({ website: w, scale, progress, seed }) {
  const lines = w.marks;
  if (w.mark === "circle") {
    const f = w.focus;
    const d = loopPath((f.x + f.width / 2) * scale, (f.y + f.height / 2) * scale, (f.width * scale) / 2 + 28, (f.height * scale) / 2 + 20, seed);
    return <Mark d={d} progress={progress} color={colors.accent} width={7} />;
  }
  return lines.map((r, i) => {
    const [x0, x1] = [r.x * scale - 4, (r.x + r.width) * scale + 4];
    const p = Math.min(1, Math.max(0, progress - i));
    if (w.mark === "underline") return <Mark key={i} d={strokePath(x0, x1, (r.y + r.height) * scale + 4, seed + i)} progress={p} color={colors.accent} width={6} />;
    return <Mark key={i} d={strokePath(x0, x1, (r.y + r.height * 0.5) * scale, seed + i)} progress={p} color={HIGHLIGHTER} width={r.height * scale * 0.95} cap="butt" />;
  });
}

// A real web page in a browser window on the desk. It scrolls down to the words
// that matter, the camera pushes in on them so they can be read, and they get
// marked. Without marks, it scrolls gently down the page. The caption says where
// the page is from and, for an archived copy, when.
export function Website({ website: w }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const seed = seedOf(`${w.url}${w.archived ?? ""}`);
  const enter = spring({ frame, fps, config: { damping: 18, mass: 0.8 } });
  const bottom = 1080 - BOTTOM_SPACE - 56;
  const windowHeight = bottom - WINDOW.top;
  const viewHeight = windowHeight - BAR;
  const scale = WINDOW.width / w.width;
  const pageHeight = w.height * scale;
  const maxScroll = Math.max(0, pageHeight - viewHeight);
  const focus = w.focus ?? null;
  const lines = w.marks ?? [];

  // Down to the marked words, or a gentle way down the page.
  const target = focus ? Math.min(maxScroll, Math.max(0, (focus.y + focus.height / 2) * scale - viewHeight * 0.45)) : Math.min(maxScroll, viewHeight * 0.5);
  const scrollStart = 0.9 * fps;
  const scrollEnd = focus
    ? scrollStart + Math.min(durationInFrames * 0.4, Math.max(0.6 * fps, (target / 900) * fps))
    : Math.max(1.2 * fps, durationInFrames * 0.6);
  const scroll = interpolate(frame, [scrollStart, scrollEnd], [0, target], { ...clamp, easing: ease });

  // The push in: enough to make body text readable, less for a headline.
  const zoomTo = focus ? Math.min(w.mark === "underline" ? 1.2 : 1.45, Math.max(1, 1150 / (focus.width * scale))) : 1;
  const zoom = interpolate(frame, [scrollEnd, scrollEnd + 1.1 * fps], [0, 1], { ...clamp, easing: ease });
  const fx = (1920 - WINDOW.width) / 2 + (focus ? (focus.x + focus.width / 2) * scale : WINDOW.width / 2);
  const fy = WINDOW.top + BAR + (focus ? (focus.y + focus.height / 2) * scale - target : viewHeight / 2);
  const k = 1 + (zoomTo - 1) * zoom;
  const camera = `translate(${(FOCUS_AT[0] - fx) * (k > 1 ? zoom : 0)}px, ${(FOCUS_AT[1] - fy) * (k > 1 ? zoom : 0)}px) scale(${k})`;

  const markStart = scrollEnd + 0.5 * fps;
  const marked = interpolate(frame, [markStart, markStart + Math.min(1.6, 0.55 * Math.max(1, lines.length)) * fps], [0, w.mark === "circle" ? 1 : lines.length], clamp);
  const push = interpolate(frame, [0, durationInFrames], [1, 1.03]);
  const site = shortURL(w.url).split("/")[0];
  const when = w.date ?? (w.archived ? monthYear(w.archived) : null);
  const caption = [site, when, w.archived ? "via the Wayback Machine" : null].filter(Boolean).join(" · ");

  return (
    <Desk>
      <AbsoluteFill style={{ transform: camera, transformOrigin: `${fx}px ${fy}px` }}>
        <AbsoluteFill style={{ alignItems: "center" }}>
          <div
            style={{
              position: "absolute",
              top: WINDOW.top,
              width: WINDOW.width,
              height: windowHeight,
              borderRadius: 14,
              overflow: "hidden",
              background: "#FFFFFF",
              boxShadow: "0 30px 80px rgba(0, 0, 0, 0.55)",
              opacity: Math.min(1, enter),
              transform: `translateY(${interpolate(enter, [0, 1], [80, 0])}px) scale(${push})`,
            }}
          >
            <div style={{ height: BAR, boxSizing: "border-box", background: "#E9E6DF", display: "flex", alignItems: "center", gap: 24, padding: "0 24px", borderBottom: "1px solid rgba(0, 0, 0, 0.12)" }}>
              <div style={{ display: "flex", gap: 10 }}>
                {[colors.danger, colors.accent, colors.accent2].map((c) => (
                  <div key={c} style={{ width: 16, height: 16, borderRadius: 8, background: c }} />
                ))}
              </div>
              <div
                style={{
                  flex: 1,
                  height: 40,
                  borderRadius: 20,
                  background: "#FFFFFF",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "0 20px",
                  fontFamily: fonts.body,
                  fontWeight: 500,
                  fontSize: 22,
                  color: colors.ink,
                }}
              >
                <Lock />
                {shortURL(w.url)}
              </div>
            </div>
            <div style={{ position: "relative", height: viewHeight, overflow: "hidden" }}>
              <div style={{ position: "absolute", left: 0, top: -scroll, width: WINDOW.width, height: pageHeight }}>
                <Img src={staticFile(w.src)} style={{ display: "block", width: WINDOW.width, height: pageHeight }} />
                {focus && (
                  <svg width={WINDOW.width} height={pageHeight} style={{ position: "absolute", inset: 0, overflow: "visible", mixBlendMode: w.mark === "highlight" ? "multiply" : "normal" }}>
                    <Marks website={w} scale={scale} progress={marked} seed={seed} />
                  </svg>
                )}
              </div>
            </div>
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
      {/* Outside the camera move, so it stays put while the page is pushed in on. */}
      <AbsoluteFill style={{ alignItems: "center" }}>
        <div
          style={{
            position: "absolute",
            top: bottom + 10,
            padding: "6px 18px",
            borderRadius: 8,
            background: `rgba(14, 20, 32, ${0.94 * zoom})`,
            fontFamily: fonts.mono,
            fontWeight: 500,
            fontSize: 24,
            color: colors.muted,
            opacity: Math.min(1, enter),
          }}
        >
          {caption}
        </div>
      </AbsoluteFill>
    </Desk>
  );
}
