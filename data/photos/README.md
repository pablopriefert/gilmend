# Demo photos: the 6 shots to take

The six demo cases (`data/demo-cases.json`) each point to one photo in this folder, named
`<name>.jpg`. **We shoot them ourselves** with real packages that we damage on purpose. No
customer photo is ever used (hackathon rule), and none of the photos may show a real person, a
real address or a real tracking label.

## Status on 27 Oct 2026: provisional stand-ins, not our photos

Today the folder holds six `<name>.webp` files. They are **provisional, AI-generated images**
(their XMP metadata says `DigitalSourceType = trainedAlgorithmicMedia`; we do not know which
tool made them). They are real WebP files and carry their true extension (they used to be named
`.jpg`, which made the agent send them to the model with the wrong MIME type). They only keep the
demo and the tests working until the real shots exist: **do not present them as photos taken by
the team, in the README, in the video or in the submission form**, and do not strip their
metadata. A vision model may also read an obviously synthetic image differently from a real
photo, so rehearse the video with the real ones.

To switch, drop `<name>.jpg` next to the stand-in (same name, see the table). The file the team
shot always wins over `<name>.webp`; delete the stand-ins once the six JPEGs are in.
`provisionalDemoPhotos()` in `src/lib/store/demo-cases.ts` lists the cases still running on a
stand-in, and `npm run demo` prints it.

## Rules for every photo

- JPEG, named exactly as below, long edge about **1600 px**, under **1 MB** (the vision model
  reads them, and the file ends up in the public repository).
- **Strip the location before committing**: phone photos carry GPS in their EXIF data.
  macOS: `exiftool -all= data/photos/*.jpg` (or export from Preview with "Location" unticked).
- Daylight or a bright lamp, plain table or floor behind the parcel.
- The parcel carries a **hand-written paper label** with the fictitious tracking number from
  the table (the research notes ask for a legible label in at least one photo). Never a real
  shipping label.
- Break things you own, with the box and padding as you would normally pack them.

## The six shots

| File | Case | What to photograph | Props |
|---|---|---|---|
| `vase-broken.jpg` | 1. Broken vase (Colissimo, tracking `6A99001001001`) | A box that looks fine on the outside, **open**, with a ceramic vase in several clean pieces inside the padding, parcel label visible in a corner. | A cheap ceramic vase to smash; kraft box with a little paper wadding. |
| `carton-crushed.jpg` | 2. Crushed carton, product intact (Chronopost, `XW990010021TS`) | A cardboard box with one corner **visibly crushed**, taken from a 3/4 angle, label on top. Optional: the framed print beside it, undamaged. | A flat box you step on (carefully) and a picture frame. |
| `lamp-blurry.jpg` | 3. Blurry photo (Colissimo, `6A99001003003`) | A lamp and its box, shot on purpose **too blurry to judge** (move the phone while shooting, or focus on the background). The agent must not be able to read the damage. | Any table lamp; a real motion blur beats a filter. |
| `parcel-open-missing.jpg` | 4. Opened parcel, item missing (Mondial Relay, `99100404`) | A box with the **flaps torn open and cut tape**, four espresso cups wrapped in paper and an **empty, flattened padding slot** where the saucers should be. Taken on a counter or table, as at a relay point. | 4 cups, torn tape, empty padding. |
| `headphones-cracked.jpg` | 5. Expensive item (Chronopost, `XW990010051TS`) | Over-ear headphones with a **cracked ear cup** and a bent hinge, next to the dented box. Use old or broken headphones: do not damage a good pair. | Spare or broken headphones; a dented box. |
| `carafe-cracked.jpg` | 6. Late report (Chronopost, `XW990010061TS`) | A glass carafe with a **crack along the neck** on a plain background. No box needed (the report comes too late for a claim, the photo only proves the damage). | A thrift-store carafe; tap the neck until it cracks. |

## Checklist before committing

- [ ] six files with the exact names above
- [ ] EXIF location removed (`exiftool -gps:all data/photos/*.jpg` prints nothing)
- [ ] no face, no real address, no real tracking number or barcode readable
- [ ] each file under 1 MB
