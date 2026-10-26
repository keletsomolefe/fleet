FLEET BRAND ASSETS

The active product name is Fleet. The existing black, white and neutral
interface colours and Montserrat typography are retained.

mark.svg: editable F symbol, with forward-cut lanes suggesting movement.
logo.svg: symbol and Fleet wordmark in outlined Montserrat SemiBold.
mark-white.svg / logo-white.svg: inverse artwork for dark surfaces.
favicon.svg: mark on a white tile for browser tabs.
preview.png: logo preview on white.

All SVG artwork consists of native paths and shapes, with no embedded
bitmaps, linked resources, scripts or font dependencies. The Montserrat
font license is included in MONTSERRAT-LICENSE.txt.

These SVG masters are the source of truth. To update web/mobile copies,
inverse variants and the native PNG launcher/splash exports, run from the
repository root with Sharp available:

  node scripts/render-fleet-brand.cjs

An optional argument points to a node_modules directory containing Sharp.
PNG files are generated only for native surfaces that require raster assets.

Web exports: apps/web/public/brand/fleet-*.svg
Mobile exports: apps/mobile/assets/brand/fleet-*

The original VHH masters, web/mobile assets and exports/VHH-Branding package
are preserved. Historical Figma records retain their original branding.
