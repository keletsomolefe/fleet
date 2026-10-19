# VHH logo conversion record

Source: `vhh-reference.png`, the user-supplied 640 × 640 reference. The original is preserved unchanged. Conversion checked on 16 October 2026.

| Asset | Output | Status / use |
| --- | --- | --- |
| Original canvas lockup | `vhh-full-vector.svg`, `vhh-full-4096.png`, `vhh-full-preview.png` | Converted and visually checked; retains square source canvas. |
| Cropped horizontal lockup | `vhh-lockup-vector.svg`, `vhh-lockup-4096.png`, `vhh-lockup-preview.png` | Converted and visually checked; used for Figma sign-in brand component. |
| Monogram | `vhh-monogram-vector.svg`, `vhh-monogram-4096.png`, `vhh-monogram-preview.png` | Converted and visually checked; used for operational headers. |
| White inverse lockup | `vhh-inverse-vector.svg`, `vhh-inverse-4096.png`, `vhh-inverse-preview.png` | Converted and visually checked; transparent white artwork, preview on dark background. |

The master SVGs contain editable groups and paths, with no embedded bitmap, live text, external resource or font dependency. Transparent PNGs have a longest edge of 4096 pixels. Black artwork previews use white backgrounds; the inverse preview uses black for visibility.

The monogram and VHH wordmark were reconstructed geometrically from the reference. GROUP and tagline lettering use outlined Arial glyphs, hand-positioned to approximate the supplied raster proportions and tracking. The original brand typeface was not supplied, so exact typographic identity cannot be certified. Background noise, faint shadows and raster antialiasing were deliberately removed. The wording and overall composition are preserved.

Figma contains native vector versions of the lockup and monogram, plus an inverse instance on the brand specimen and admin sign-in screen. No full-screen UI raster was imported. Regeneration uses `scripts/redraw-logo.swift` (macOS CoreText) and `scripts/render-brand.cjs` (the existing bundled Sharp runtime); no project package installation was required.
