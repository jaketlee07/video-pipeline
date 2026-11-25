import { Video } from "@remotion/media";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts } from "../theme.js";
import { Aerial } from "./Aerial.jsx";
import { Change } from "./Change.jsx";

// Directions for the slow drift, picked by scene so consecutive photos move differently.
const DRIFTS = [
  [1, 0],
  [-1, 0.4],
  [0, 1],
  [-0.6, -1],
];

// A stock clip, a photo with a slow pan and zoom, an aerial zoom onto a real
// place, or a site from above before and after, filling the frame. `dim`
// darkens it for big words or a number on top.
export function Footage({ media, seed, dim = false }) {
  if (media.kind === "aerial") return <Aerial media={media} dim={dim} />;
  if (media.kind === "change") return <Change media={media} dim={dim} />;
  return <Shot media={media} seed={seed} dim={dim} />;
}

function Shot({ media, seed, dim }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const progress = frame / durationInFrames;
  const zoomIn = seed % 2 === 0;
  const isPhoto = media.kind === "photo";
  const [dx, dy] = DRIFTS[seed % DRIFTS.length];
  const scale = isPhoto ? interpolate(progress, [0, 1], zoomIn ? [1.05, 1.17] : [1.17, 1.05]) : interpolate(progress, [0, 1], [1, 1.05]);
  const shift = interpolate(progress, [0, 1], [-1, 1]) * (isPhoto ? 36 : 0);
  return (
    <AbsoluteFill style={{ backgroundColor: colors.background }}>
      <AbsoluteFill style={{ transform: `scale(${scale}) translate(${dx * shift}px, ${dy * shift}px)` }}>
        {isPhoto ? (
          <Img src={staticFile(media.src)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <Video
            src={staticFile(media.src)}
            muted
            loop
            objectFit="cover"
            playbackRate={media.rate}
            trimBefore={media.trimBefore}
            style={{ width: "100%", height: "100%" }}
          />
        )}
      </AbsoluteFill>
      {dim && <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 45%, rgba(8, 12, 20, 0.62) 0%, rgba(8, 12, 20, 0.84) 75%)" }} />}
      {/* Darkens the bottom edge so photo credits stay readable. */}
      <AbsoluteFill style={{ background: "linear-gradient(to top, rgba(8, 12, 20, 0.55) 0%, rgba(8, 12, 20, 0) 16%)" }} />
      {media.credit && (
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
          {media.credit}
        </div>
      )}
    </AbsoluteFill>
  );
}
