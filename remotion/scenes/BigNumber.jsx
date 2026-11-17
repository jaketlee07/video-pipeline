import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { BOTTOM_SPACE, colors, fonts } from "../theme.js";
import { Backdrop } from "./Backdrop.jsx";
import { Mark, seedOf, strokePath } from "./Scribble.jsx";

// One big number with a short label. Single numbers count up from zero. After a
// shot, the number goes over that shot, darkened.
export function BigNumber({ number, backdrop, seed }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 } });
  const labelIn = spring({ frame: frame - 12, fps, config: { damping: 200 } });
  const counted = interpolate(frame, [0, 1.3 * fps], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const { count } = number;
  const shown = count
    ? `${count.prefix}${(count.to * counted).toLocaleString("en-US", { minimumFractionDigits: count.decimals, maximumFractionDigits: count.decimals })}${count.suffix}`
    : number.headline;
  const size = Math.min(300, 1900 / Math.max(4, number.headline.length * 0.62));
  // Underlined by hand once it has landed, about as wide as the number.
  const underline = interpolate(frame, [1.4 * fps, 1.9 * fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const width = Math.min(1500, number.headline.length * size * 0.5);
  return (
    <Backdrop media={backdrop} seed={seed}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingBottom: BOTTOM_SPACE - 60 }}>
        <div
          style={{
            fontFamily: fonts.display,
            fontWeight: 800,
            fontSize: size,
            lineHeight: 1,
            color: colors.accent,
            fontVariantNumeric: "tabular-nums",
            opacity: enter,
            transform: `scale(${interpolate(enter, [0, 1], [0.85, 1])})`,
          }}
        >
          {shown}
        </div>
        <svg width={width + 40} height={34} style={{ marginTop: 6, overflow: "visible" }}>
          <Mark d={strokePath(20, width + 20, 14, seedOf(number.headline))} progress={underline} color={colors.text} width={7} opacity={0.9} />
        </svg>
        <div
          style={{
            marginTop: 14,
            maxWidth: 1300,
            fontFamily: fonts.body,
            fontWeight: 600,
            fontSize: 50,
            lineHeight: 1.25,
            textAlign: "center",
            color: colors.text,
            opacity: labelIn,
            transform: `translateY(${interpolate(labelIn, [0, 1], [24, 0])}px)`,
          }}
        >
          {number.label}
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
}
