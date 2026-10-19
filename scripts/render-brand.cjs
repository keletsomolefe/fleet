const fs=require('fs'),path=require('path');
const sharp=require('/Users/keletso/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
// Keep app exports on the same geometry as the editable SVG masters.
const appExports = {
  monogram: { file: 'monogram.svg', width: 66.75, height: 54.25, viewBox: '2 211 267 217' },
  inverse: { file: 'brand-white.svg', width: 300.5, height: 117.5, viewBox: '2 211 601 235' },
};
(async()=>{for(const name of ['full','lockup','monogram','inverse']){const p=path.join(__dirname,'../assets/brand/vhh-'+name+'-vector.svg');const svg=fs.readFileSync(p,'utf8');if(/<(image|text|foreignObject)\b/.test(svg)||/href=/.test(svg))throw Error('Non-outline content');const ids=[...svg.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);if(new Set(ids).size!==ids.length)throw Error('Duplicate IDs');const stem=p.replace('-vector.svg','');await sharp(Buffer.from(svg)).resize({width:4096}).png().toFile(stem+'-4096.png');await sharp(Buffer.from(svg)).resize({width:1280}).flatten({background:name==='inverse'?'#111111':'#ffffff'}).png().toFile(stem+'-preview.png');const app=appExports[name];if(app){const exported=svg.replace(/width="[^"]+"/,`width="${app.width}"`).replace(/height="[^"]+"/,`height="${app.height}"`).replace(/viewBox="[^"]+"/,`viewBox="${app.viewBox}"`);fs.writeFileSync(path.join(__dirname,'../apps/web/public/design',app.file),exported);}console.log(name+' vectors validated and PNGs rendered');}})();
