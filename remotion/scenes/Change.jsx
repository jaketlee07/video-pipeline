import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts } from "../theme.js";
import { Mark, loopPath, seedOf } from "./Scribble.jsx";

const W = 1920;
const H = 1080;
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" };

function YearTag({ year }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 70,
        bottom: 84,
        padding: "8px 26px 4px",
        borderRadius: 8,
        background: "rgba(14, 20, 32, 0.82)",
        fontFamily: fonts.display,
        fontWeight: 800,
        fontSize: 92,
        lineHeight: 1,
        letterSpacing: 2,
        color: colors.text,
      }}
    >
      {year}
    </div>
  );
}

// A site from above in two years: the year before it changed, then a line sweeps
// across the frame revealing the year after, and the site gets circled. Both
// pictures cover exactly the same ground, so nothing moves but what changed.
// `intro` is false when the shot continues under a later scene, which then stays
// on the after picture.
export function Change({ media, dim = false }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const t = frame / Math.max(1, durationInFrames - 1);
  const intro = media.intro !== false;
  const { x0, x1, y0, y1 } = media.site;
  const [cx, cy] = [((x0 + x1) / 2) * W, ((y0 + y1) / 2) * H];
  // A slow push in on the site the whole time.
  const push = interpolate(t, [0, 1], intro ? [1, 1.07] : [1.07, 1.1]);
  const wipeStart = Math.max(1.4 * fps, durationInFrames * 0.32);
  const wipe = intro ? interpolate(frame, [wipeStart, wipeStart + 1.7 * fps], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) }) : 1;
  const line = wipe * W;
  const drawn = intro ? interpolate(frame, [wipeStart + 1.9 * fps, wipeStart + 2.7 * fps], [0, 1], clamp) : 1;
  const labelIn = intro ? interpolate(t, [0.03, 0.1], [0, 1], clamp) : 0;
  const layer = (shot, clip) => (
    <AbsoluteFill style={{ clipPath: clip }}>
      <AbsoluteFill style={{ transform: `scale(${push})`, transformOrigin: `${cx}px ${cy}px` }}>
        <Img src={staticFile(shot.src)} style={{ width: W, height: H, objectFit: "cover", filter: "contrast(1.06) saturate(1.12)" }} />
      </AbsoluteFill>
      {!dim && <YearTag year={shot.year} />}
    </AbsoluteFill>
  );
  // The circle, where the site is once pushed in.
  const at = (x, y) => [cx + (x - cx) * push, cy + (y - cy) * push];
  const [ax, ay] = at(x0 * W, y0 * H);
  const [bx, by] = at(x1 * W, y1 * H);

  return (
    <AbsoluteFill style={{ backgroundColor: colors.background, overflow: "hidden" }}>
      {layer(media.before, "none")}
      {wipe > 0 && layer(media.after, `inset(0 ${W - line}px 0 0)`)}
      {intro && wipe > 0 && wipe < 1 && (
        <div style={{ position: "absolute", top: 0, bottom: 0, left: line - 3, width: 6, background: colors.accent, boxShadow: `0 0 24px ${colors.accent}` }} />
      )}
      {dim && <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 45%, rgba(8, 12, 20, 0.62) 0%, rgba(8, 12, 20, 0.84) 75%)" }} />}
      {!dim && media.circle && (
        <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
          <Mark
            d={loopPath((ax + bx) / 2, (ay + by) / 2, Math.max(90, ((bx - ax) / 2) * 1.2), Math.max(70, ((by - ay) / 2) * 1.2), seedOf(media.label))}
            progress={drawn}
            color={colors.accent}
            width={7}
            opacity={0.95}
          />
        </svg>
      )}
      {labelIn > 0 && !dim && (
        <>
          <AbsoluteFill style={{ background: "radial-gradient(ellipse at 0% 0%, rgba(8, 12, 20, 0.7) 0%, rgba(8, 12, 20, 0) 42%)", opacity: labelIn }} />
          <div style={{ position: "absolute", left: 70, top: 58, opacity: labelIn, transform: `translateY(${(1 - labelIn) * -12}px)` }}>
            <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 58, lineHeight: 1, letterSpacing: 1, textTransform: "uppercase", color: colors.text, textShadow: "0 2px 8px rgba(0, 0, 0, 0.7)" }}>
              {media.label}
            </div>
            {media.sublabel && (
              <div style={{ marginTop: 8, fontFamily: fonts.body, fontWeight: 600, fontSize: 30, color: colors.text, textShadow: "0 1px 6px rgba(0, 0, 0, 0.8)" }}>{media.sublabel}</div>
            )}
          </div>
        </>
      )}
      {/* Darkens the bottom edge so the imagery credit stays readable. */}
      <AbsoluteFill style={{ background: "linear-gradient(to top, rgba(8, 12, 20, 0.55) 0%, rgba(8, 12, 20, 0) 16%)" }} />
      <div
        style={{
          position: "absolute",
          right: 28,
          bottom: 22,
          fontFamily: fonts.body,
          fontWeight: 500,
          fontSize: 20,
          color: "rgba(243, 239, 230, 0.7)",
          textShadow: "0 1px 3px rgba(0, 0, 0, 0.8)",
        }}
      >
        Imagery: USDA NAIP · Microsoft Planetary Computer
      </div>
    </AbsoluteFill>
  );
}
