const fs = require('node:fs/promises');
const path = require('node:path');

// Optional argument: a node_modules directory containing the Sharp renderer.
const sharp = require(process.argv[2] ? path.resolve(process.argv[2], 'sharp') : 'sharp');
const root = path.resolve(__dirname, '..');
const masters = path.join(root, 'assets/brand/fleet');
const web = path.join(root, 'apps/web/public/brand');
const mobile = path.join(root, 'apps/mobile/assets/brand');

async function main() {
  await fs.mkdir(web, { recursive: true });
  const sources = {};
  for (const name of ['mark', 'logo', 'favicon']) {
    const svg = await fs.readFile(path.join(masters, `${name}.svg`), 'utf8');
    if (/<(?:image|text|foreignObject|script)\b|\bhref\s*=/i.test(svg)) {
      throw new Error(`${name}.svg must contain self-contained vector outlines.`);
    }
    sources[name] = svg;
  }
  for (const name of ['mark', 'logo']) {
    sources[`${name}-white`] = sources[name].replaceAll('#111111', '#ffffff');
    await fs.writeFile(path.join(masters, `${name}-white.svg`), sources[`${name}-white`]);
  }
  for (const [name, svg] of Object.entries(sources)) {
    await fs.writeFile(path.join(web, `fleet-${name}.svg`), svg);
    if (name === 'mark' || name === 'logo') {
      await fs.writeFile(path.join(mobile, `fleet-${name}.svg`), svg);
    }
  }

  await sharp(Buffer.from(sources.mark)).resize(512).png()
    .toFile(path.join(mobile, 'fleet-mark.png'));
  await sharp(Buffer.from(sources.favicon)).resize(128).png()
    .toFile(path.join(mobile, 'fleet-favicon.png'));

  // Keep all adaptive-icon artwork inside the central Android safe zone.
  const symbol = sources.mark.match(/<path\b[^>]*\/>/)[0];
  const icon = (background, transform) => Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${background}<g transform="${transform}">${symbol}</g></svg>`,
  );
  await sharp(icon('<rect width="1024" height="1024" fill="#ffffff"/>', 'translate(85.333333 85.333333) scale(13.333333)'))
    .png().toFile(path.join(mobile, 'fleet-app-icon.png'));
  await sharp(icon('', 'translate(224 224) scale(9)'))
    .png().toFile(path.join(mobile, 'fleet-adaptive-icon.png'));

  await sharp(Buffer.from(sources.logo)).resize(832).extend({
    top: 64, bottom: 64, left: 64, right: 64, background: '#ffffff',
  }).flatten({ background: '#ffffff' }).png()
    .toFile(path.join(masters, 'preview.png'));
  console.log('Fleet SVG copies and native PNG icons exported. Original VHH assets are unchanged.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
