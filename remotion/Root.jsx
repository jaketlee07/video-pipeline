import { Composition, Still } from "remotion";
import { LongForm } from "./LongForm.jsx";
import { Banner, ProfilePicture } from "./stills/ChannelArt.jsx";
import { Thumbnail } from "./stills/Thumbnail.jsx";

// Props come from src/render.mjs (the video), src/package.mjs (thumbnails) and
// src/channel-art.mjs (profile picture and banner).
export const Root = () => (
  <>
    <Composition
      id="LongForm"
      component={LongForm}
      width={1920}
      height={1080}
      fps={30}
      durationInFrames={30}
      defaultProps={{ fps: 30, duration: 1, scenes: [], music: false }}
      calculateMetadata={({ props }) => ({ durationInFrames: Math.max(1, Math.ceil(props.duration * props.fps)) })}
    />
    <Still id="Thumbnail" component={Thumbnail} width={1280} height={720} defaultProps={{ kicker: "", headline: "", accent: "", panels: [], receipt: null }} />
    <Still id="ProfilePicture" component={ProfilePicture} width={800} height={800} defaultProps={{ variant: "receipt" }} />
    <Still id="Banner" component={Banner} width={2048} height={1152} defaultProps={{}} />
  </>
);
