# Demo photos: generated with Muse Image

The six demo cases (`data/demo-cases.json`) each point to one photo in this folder, named
`<name>.webp` (a `<name>.jpg` placed next to one replaces it). The six photos are generated with
Muse Image (below). No customer photo is ever used (hackathon rule), and none of the photos may
show a real person, a real address or a real tracking label.

## How they were made (27 Oct 2026)

The folder holds six `<name>.webp` files **generated with Meta's Muse Image**
(`muse-image-1.0`, Meta Model API, `/v1/images/generations`) on 27 Oct 2026, with
[`scripts/generate-demo-photo.mjs`](../../scripts/generate-demo-photo.mjs) (the prompt of the
vase is in its header). They show fictitious parcels: no real customer, no real address, no
real shipping label. Their XMP metadata says `DigitalSourceType = trainedAlgorithmicMedia`; do
not strip it.

Say it everywhere they appear: **AI-generated with Muse Image, not photos taken by the team**
(README, video, submission form). All six demo cases were run end to end on the real Muse Spark
1.3 and SAM 3.1 with these images on 27 Oct 2026. The recorded run of each case reached the decision
the demo script expects, but Muse is not stable on every photo (the vase was read twice with a claim
and twice without it, the blurry lamp once handed to a human and once not; README, "Measured on the
real models"). A real photo may read differently again, so a real shot is worth trying before filming.

## Optional: switching to a real photo later

To switch a case to a real photo, drop `<name>.jpg` next to the generated one (same name, see the
table). A JPEG always wins over `<name>.webp`. `provisionalDemoPhotos()` in
`src/lib/store/demo-cases.ts` lists the cases still running on a generated image, and
`npm run demo` prints it. The recorded runs in `data/showcase/` keep their own pinned copy of the
photo Muse saw, so they do not change; a real photo means re-running the case.

## Rules for every real photo

- JPEG, named exactly as below, long edge about **1600 px**, under **1 MB** (the vision model
  reads them, and the file ends up in the public repository).
- **Strip the location before committing**: phone photos carry GPS in their EXIF data.
  macOS: `exiftool -all= data/photos/*.jpg` (or export from Preview with "Location" unticked).
- Daylight or a bright lamp, plain table or floor behind the parcel.
- The parcel carries a **hand-written paper label** with the fictitious tracking number from
  the table. Never a real shipping label.
- Break things you own, with the box and padding as you would normally pack them.

## The six shots, if you take real ones

| File | Case | What to photograph | Props |
|---|---|---|---|
| `vase-broken.jpg` | 1. Broken vase (Colissimo, tracking `6A99001001001`) | A box that looks fine on the outside, **open**, with a ceramic vase in several clean pieces inside the padding, parcel label visible in a corner. | A cheap ceramic vase to smash; kraft box with a little paper wadding. |
| `carton-crushed.jpg` | 2. Crushed carton, product intact (Chronopost, `XW990010021TS`) | A cardboard box with one corner **visibly crushed**, taken from a 3/4 angle, label on top. Optional: the framed print beside it, undamaged. | A flat box you step on (carefully) and a picture frame. |
| `lamp-blurry.jpg` | 3. Blurry photo (Colissimo, `6A99001003003`) | A lamp and its box, shot on purpose **too blurry to judge** (move the phone while shooting, or focus on the background). The agent must not be able to read the damage. | Any table lamp; a real motion blur beats a filter. |
| `parcel-open-missing.jpg` | 4. Opened parcel, item missing (Mondial Relay, `99100404`) | A box with the **flaps torn open and cut tape**, four espresso cups wrapped in paper and an **empty, flattened padding slot** where the saucers should be. Taken on a counter or table, as at a relay point. | 4 cups, torn tape, empty padding. |
| `headphones-cracked.jpg` | 5. Expensive item (Chronopost, `XW990010051TS`) | Over-ear headphones with a **cracked ear cup** and a bent hinge, next to the dented box. Use old or broken headphones: do not damage a good pair. | Spare or broken headphones; a dented box. |
| `carafe-cracked.jpg` | 6. Late report (Chronopost, `XW990010061TS`) | A glass carafe with a **crack along the neck** on a plain background. No box needed (the report comes too late for a claim, the photo only proves the damage). | A thrift-store carafe; tap the neck until it cracks. |

## Checklist before committing a real photo

- [ ] six files with the exact names above
- [ ] EXIF location removed (`exiftool -gps:all data/photos/*.jpg` prints nothing)
- [ ] no face, no real address, no real tracking number or barcode readable
- [ ] each file under 1 MB
