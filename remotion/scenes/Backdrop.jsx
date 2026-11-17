import { AbsoluteFill, useCurrentFrame } from "remotion";
import { colors } from "../theme.js";
import { Footage } from "./Footage.jsx";

// The background behind every graphic: a soft glow and a slowly drifting dot grid.
// Given a shot (`media`), the graphic goes over that shot, darkened, instead.
export function Backdrop({ children, media, seed = 0 }) {
  const drift = useCurrentFrame() * 0.15;
  if (media) {
    return (
      <AbsoluteFill>
        <Footage media={media} seed={seed} dim />
        {children}
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 40%, ${colors.panel} 0%, ${colors.background} 70%)` }}>
      <AbsoluteFill
        style={{
          backgroundImage: `radial-gradient(${colors.line} 1.5px, transparent 1.5px)`,
          backgroundSize: "36px 36px",
          backgroundPosition: `${drift}px ${drift / 2}px`,
          opacity: 0.45,
        }}
      />
      {children}
    </AbsoluteFill>
  );
}
