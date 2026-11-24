import { cp, mkdir, rm } from 'node:fs/promises';
const assets = [
  'index.html', 'app.js', 'config.js', 'language.js', 'adsense.js',
  'credits.js', 'credit-utils.mjs', 'icon.svg', 'servcycl-serving.svg',
  'manifest.webmanifest', 'sw.js', 'ads.txt', 'vendor/qrcode.js'
];
await rm('dist', { recursive: true, force: true });
await mkdir('dist/vendor', { recursive: true });
for (const asset of assets) await cp(asset, 'dist/' + asset);
console.log('Published ' + assets.length + ' ServCycl assets to dist.');
