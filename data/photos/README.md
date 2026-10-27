# Demo photos: generated with Muse Image

The six demo cases (`data/demo-cases.json`) each point to one photo in this folder, named
`<name>.webp` (a `<name>.jpg` placed next to one replaces it). The six photos are generated with
Muse Image (below), and so is a seventh, `lamp-sharp.webp`, which belongs to no case of its own: it is
the sharp photo of the "Demo: simulate the customer's reply" button on the blurry-lamp case (below). No
customer photo is ever used (hackathon rule), and none of the photos may show a real person, a real
address or a real tracking label.

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
and twice without it, the blurry lamp once handed to a human and once not, the opened parcel as
"missing item", then "opened parcel", then "missing item" again, and the headphones outlined once as
two ear cushions and once as the whole pair; README, "Measured on the real models"). A real photo may read differently again, so a real shot is worth trying before filming.

## The seventh photo: `lamp-sharp.webp` (28 Oct 2026)

`lamp-sharp.webp` is the customer's answer in the follow-up loop (README, "The follow-up loop"): the
blurry-lamp case (`lamp-blurry.webp`, order #1003) ends in "ask for sharper photos", and the demo button
loads this photo as the reply. **Generated with Meta's Muse Image** (`muse-image-1.0`, one call, one image, kept
as it came out, XMP `DigitalSourceType = trainedAlgorithmicMedia`: do not strip it), with
[`scripts/generate-demo-photo.mjs`](../../scripts/generate-demo-photo.mjs) and this prompt:

> Realistic sharp smartphone photo taken by a customer at home in bright daylight, in focus, on a wooden
> floor. An opened brown kraft shipping box with crumpled paper padding. Inside the box a brass table lamp
> with a milky white glass shade lies on its side: the glass shade is cracked from the rim up with a clear
> jagged crack, and a broken chunk of glass is missing from the edge, small glass splinters in the padding.
> The same lamp as in the blurry photo of the same parcel: brass base, white shade, open cardboard box. A
> small hand-written paper label taped on the box corner reads 6A99001003003. Slightly imperfect framing,
> natural phone photo, no people, no logos, no printed shipping label.

Say what it is wherever it appears: **AI-generated with Muse Image, not a photo taken by the team, and not
the same pixels as the blurry photo** (a separate generation of a lamp of the same kind: brass base, white
shade, open kraft box; the shade is white, the order says "glass shade"). The case page labels the reply
"Simulated reply" and the server recognises this file byte for byte to do so, so **do not re-encode, resize
or replace it** without also changing what `src/app/api/cases/[id]/follow-up/route.ts` compares against (it
reads this very file). It is served by `/api/demo-photo?name=lamp-sharp` and is not part of the six demo
cases, so `npm run demo` does not use it. On the real Muse Spark 1.3 and SAM 3.1 it was read as a broken
product (severity major, photo quality good) and SAM 3.1 outlined the lamp, in one run (README, "A real
follow-up round").

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
