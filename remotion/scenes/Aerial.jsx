import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts } from "../theme.js";
import { Mark, loopPath, seedOf } from "./Scribble.jsx";

const W = 1920;
const H = 1080;
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" };
const ease = Easing.inOut(Easing.cubic);

// The camera flying down onto a real place. `media.levels` are images of the same
// spot at halving scales, each twice the frame: the finest one that still fills
// the frame is shown, faded in over the one before, so the picture stays sharp all
// the way down. The zoom slows as it arrives but never quite stops. A site gets
// circled once the camera is there. On a return visit (`move` "out" or "close")
// the camera starts close, with the circle already drawn, and pulls back out or
// drifts in. `intro` is false when the shot continues under a later scene, which
// then pushes in a little further without the label.
export function Aerial({ media, dim = false }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const t = frame / Math.max(1, durationInFrames - 1);
  const intro = media.intro !== false;
  const arriving = intro && (media.move ?? "in") === "in";
  const p = !intro ? t : arriving ? 0.9 * ease(Math.min(t / 0.75, 1)) + 0.1 * t : 0.85 * ease(t) + 0.15 * t;
  const mpp = Math.exp(Math.log(media.startMpp) + (Math.log(media.endMpp) - Math.log(media.startMpp)) * p);
  // Screen pixels per image pixel.
  const scales = media.levels.map((l) => l.mpp / mpp);
  let finest = 0;
  for (const [i, s] of scales.entries()) if (media.levels[i].width * s >= W && media.levels[i].height * s >= H) finest = i;
  const fadeIn = finest === 0 ? 1 : interpolate(media.levels[finest].width * scales[finest], [W, W * 1.24], [0, 1], clamp);
  const layer = (i, opacity) => {
    const { src, width, height } = media.levels[i];
    const [w, h] = [width * scales[i], height * scales[i]];
    return (
      <Img
        key={src}
        src={staticFile(src)}
        style={{ position: "absolute", left: (W - w) / 2, top: (H - h) / 2, width: w, height: h, opacity, filter: "contrast(1.06) saturate(1.12)" }}
      />
    );
  };

  // The site's outline on screen (Mercator y points north, screen y down).
  let circle = null;
  if (media.circle && media.box) {
    const [x0, y0, x1, y1] = media.box;
    const cx = W / 2 + (x0 + x1) / 2 / mpp;
    const cy = H / 2 - (y0 + y1) / 2 / mpp;
    const rx = Math.max(90, ((x1 - x0) / 2 / mpp) * 1.3);
    const ry = Math.max(70, ((y1 - y0) / 2 / mpp) * 1.3);
    const drawn = !intro ? 1 : interpolate(t, arriving ? [0.66, 0.8] : [0.04, 0.18], [0, 1], clamp);
    circle = <Mark d={loopPath(cx, cy, rx, ry, seedOf(media.label))} progress={drawn} color={colors.accent} width={7} opacity={0.95} />;
  }
  const labelIn = intro ? interpolate(t, [0.04, 0.12], [0, 1], clamp) : 0;

  return (
    <AbsoluteFill style={{ backgroundColor: colors.background, overflow: "hidden" }}>
      {finest > 0 && layer(finest - 1, 1)}
      {layer(finest, fadeIn)}
      {dim && <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 45%, rgba(8, 12, 20, 0.62) 0%, rgba(8, 12, 20, 0.84) 75%)" }} />}
      {!dim && (
        <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
          {circle}
        </svg>
      )}
      {labelIn > 0 && !dim && (
        <>
          <AbsoluteFill style={{ background: "radial-gradient(ellipse at 0% 0%, rgba(8, 12, 20, 0.7) 0%, rgba(8, 12, 20, 0) 42%)", opacity: labelIn }} />
          <div style={{ position: "absolute", left: 70, top: 58, opacity: labelIn, transform: `translateY(${(1 - labelIn) * -12}px)` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <svg width={30} height={40} viewBox="0 0 30 40">
                <path d="M15 1C7.3 1 1.5 6.8 1.5 14.3 1.5 24.5 15 39 15 39S28.5 24.5 28.5 14.3C28.5 6.8 22.7 1 15 1Z" fill={colors.accent} stroke={colors.background} strokeWidth={2} />
                <circle cx={15} cy={14.5} r={5} fill={colors.background} />
              </svg>
              <div
                style={{
                  fontFamily: fonts.display,
                  fontWeight: 800,
                  fontSize: 58,
                  lineHeight: 1,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  color: colors.text,
                  textShadow: "0 2px 8px rgba(0, 0, 0, 0.7)",
                }}
              >
                {media.label}
              </div>
            </div>
            {media.sublabel && (
              <div style={{ marginTop: 8, marginLeft: 46, fontFamily: fonts.body, fontWeight: 600, fontSize: 30, color: colors.text, textShadow: "0 1px 6px rgba(0, 0, 0, 0.8)" }}>
                {media.sublabel}
              </div>
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
        Imagery: USDA NAIP · USGS The National Map
      </div>
    </AbsoluteFill>
  );
}
