// The channel's profile picture and banner (remotion/stills/ChannelArt.jsx), in the
// videos' palette and fonts, written to media/channel/:
//
//   npm run channel-art
//
// profile-receipt.png and profile-monogram.png are two takes on the profile picture
// (upload one, 800×800); banner.png is the banner (2048×1152, with the name and line
// inside the 1235×338 middle that every device shows). Files from an earlier run
// move to media/channel/earlier/ rather than being replaced.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { keepEarlier } from "./paths.mjs";

const ENTRY = fileURLToPath(new URL("../remotion/index.jsx", import.meta.url));
const OUT = fileURLToPath(new URL("../media/channel/", import.meta.url));

const ART = [
  { file: "profile-receipt.png", id: "ProfilePicture", props: { variant: "receipt" } },
  { file: "profile-monogram.png", id: "ProfilePicture", props: { variant: "monogram" } },
  { file: "banner.png", id: "Banner", props: {} },
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  console.log("Rendering the channel art...");
  const serveUrl = await bundle({ entryPoint: ENTRY });
  for (const { file, id, props } of ART) {
    const composition = await selectComposition({ serveUrl, id, inputProps: props });
    keepEarlier(join(OUT, file));
    await renderStill({ serveUrl, composition, inputProps: props, output: join(OUT, file), imageFormat: "png" });
    console.log(`  media/channel/${file} (${composition.width}×${composition.height})`);
  }
  console.log(`
Upload in YouTube Studio, Customization, Branding: one of the profile pictures, and the banner.
  Open: open media/channel/`);
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
