# Supplemental exercise artwork

Reviewed on 2026-10-16. These images supplement, rather than replace or relicense, the existing wger artwork.

## Everkinetic

- Creator: Everkinetic (Greg Priday), as identified by the official repository README.
- Source: https://github.com/everkinetic/data/tree/446bb9a3d0c3beb6b84f7c9d77dfc8af707a2ab6
- License: Creative Commons Attribution-ShareAlike 4.0 International. The upstream license and README are included as `everkinetic-LICENSE.md` and `everkinetic-README.md`.
- 18 unchanged PNGs: relaxation/tension pairs for `0066`, `0127`, `0142`, `0156`, `0157`, `0210`, `0236`, `0279`, `0093`. Downloaded through the GitHub Contents API at that commit and checked against the repository Git blob hashes. Per-file SHA-256 hashes and original links are in `scripts/exercise-image-supplements.json`.
- The `0093` artwork depicts an underhand cable pulldown variation, explicitly disclosed in the library. It is not used for a plate-loaded pulldown.

## Workout Guide

- Creator: Bryl Lim, https://bryllim.com
- Package: `@bryllim/workout-guide@1.0.0`, https://www.npmjs.com/package/@bryllim/workout-guide/v/1.0.0
- Archive: https://registry.npmjs.org/@bryllim/workout-guide/-/workout-guide-1.0.0.tgz
- Archive integrity: `sha512-N593OR3vyT/C1sDpdM/UoF5gHUwEAziExxo9Y0awMLyPpCvx8DnIAlOFJ9kHk/TZwhbWN6WoCEASAEX5ZbiIGQ==`
- Included frame: `package/assets/machine-lateral-raise/frame-1.png`. The exact frame attribution is retained in the supplemental manifest. This frame's manifest credits Bryl Lim and does not identify an Everkinetic derivative source; do not assign the whole package's Everkinetic attribution indiscriminately to this frame.
- Artwork license: CC BY-SA 4.0. Upstream notices: `workout-guide-LICENSE-ASSETS`, `workout-guide-ATTRIBUTION.md`, `workout-guide-LICENSES.md`. The included `workout-guide-LICENSE` is the separate MIT license for upstream software/documentation, not the image license.
- The PNG is unchanged. Its white lines are inverted to dark lines by CSS for readable display; that presentation change is disclosed in the library and image metadata. This is a single raised-arm illustration, not a complete movement sequence. No claim is made about its AI-generation status.

## Integration and reuse

All images are bundled under `gui/public/exercise-images/`; browsing, searching and recording workouts never fetch these remote sources. Attribution and license links are shown with each image. General schematics are not individual technique assessment or medical advice.

Retain the applicable attribution, source, license and modification notices when redistributing; adaptations must comply with the relevant ShareAlike terms. Original image licenses remain in force.

`withImageSupplements` validates matching exercise identities and local file hashes before merging the reviewed image list. Both modes of `scripts/fetch-exercise-assets.mjs` use it, so refreshing the wger catalog preserves these images. A missing/corrupt bundled image fails the refresh rather than silently reverting an entry to text-only.
