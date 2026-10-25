// Builds index.html (installable PWA, separate files) and artifact.html (single file for the claude.ai artifact viewer).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root = path.resolve(new URL('..', import.meta.url).pathname);
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const JS = ['js/db.js', 'js/stickers.js', 'js/hwr.js', 'js/hwrclient.js', 'js/transform.js', 'js/cover.js', 'js/editor.js', 'js/bookopen.js', 'js/paper.js', 'js/search.js', 'js/lock.js', 'js/app.js'];
const FONTS = 'https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,500;9..144,700&family=Caveat:wght@400;600&family=Patrick+Hand&family=Kalam&family=Indie+Flower&family=Architects+Daughter&family=Shadows+Into+Light&family=Gloria+Hallelujah&family=Homemade+Apple&family=Nanum+Pen+Script&family=Lora:ital@0;1&family=Courier+Prime&display=swap';
const swVersion = (read('sw.js').match(/VERSION = 'inkleaf-v([\d.]+)'/) || [])[1]; const appVersion = (read('js/app.js').match(/APP_VERSION = '([\d.]+)'/) || [])[1];
if (!swVersion || swVersion !== appVersion) throw new Error(`version mismatch: sw.js ${swVersion} vs js/app.js ${appVersion}`);
const shell = read('src/shell.html');
const css = read('css/app.css');
// Applies the saved appearance before the first paint. It is the only inline script in index.html: the
// Content-Security-Policy in netlify.toml allows it by hash and so blocks every other inline script —
// including the "Powered by Netlify" badge that Netlify injects into pages of free-plan sites.
const THEME = `(function(){try{var t=localStorage.getItem('inkleafTheme')||'light';if(t!=='auto')document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;
const themeHash = `'sha256-${crypto.createHash('sha256').update(THEME, 'utf8').digest('base64')}'`;
{
  const toml = read('netlify.toml'), hashes = toml.match(/'sha256-[A-Za-z0-9+/=]+'/g) || [];
  if (!hashes.length) throw new Error('netlify.toml has no script hash in its Content-Security-Policy');
  if (hashes.some(h => h !== themeHash)) { fs.writeFileSync(path.join(root, 'netlify.toml'), toml.replace(/'sha256-[A-Za-z0-9+/=]+'/g, themeHash)); console.log('netlify.toml: updated the inline-script hash to', themeHash); }
}
// the single-file build has no icons folder: inline the images the stylesheet refers to
const cssInline = css.replace(/url\(\.\.\/icons\/([\w.-]+)\)/g, (m, f) => `url(data:image/png;base64,${fs.readFileSync(path.join(root, 'icons', f)).toString('base64')})`);

const index = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<title>Inkleaf</title>
<meta name="description" content="Offline notebooks with custom covers, handwriting that turns into typed text, photos, video links and search.">
<meta name="theme-color" content="#FFFFFF">
<meta name="color-scheme" content="light dark">
<script>${THEME}</script>
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Inkleaf">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" sizes="192x192" href="icons/icon-192.png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="css/app.css">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}</style>
</head>
<body>
${shell}
${JS.map(j => `<script src="${j}"></script>`).join('\n')}
</body>
</html>
`;
fs.writeFileSync(path.join(root, 'index.html'), index);

const js = JS.map(read).join('\n;\n');
for (const f of ['js/lexicon.js', 'js/hwr.js', 'js/crnn.js', 'js/crnn-wasm.js', 'js/crnn-weights.js']) if (/<\/script/i.test(read(f))) throw new Error(f + ' contains a closing script tag');
if (/<\/script/i.test(js)) throw new Error('JS contains a closing script tag');
const artifact = `<meta charset="utf-8">
<title>Inkleaf</title>
<script>${THEME}</script>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="${FONTS}">
<style>
${cssInline}
</style>
${shell}
<script type="text/plain" id="lexicon-src">
${read('js/lexicon.js')}
</script>
<script type="text/plain" id="hwr-src">
${read('js/hwr.js')}
</script>
<script type="text/plain" id="crnn-src">
${read('js/crnn.js')}
</script>
<script type="text/plain" id="crnn-wasm-src">
${read('js/crnn-wasm.js')}
</script>
<script type="text/plain" id="crnn-weights-src">
${read('js/crnn-weights.js')}
</script>
<script>
window.__INKLEAF_NO_SW = true;
${js}
</script>
`;
fs.writeFileSync(path.join(root, 'artifact.html'), artifact);
console.log('built index.html (%d KB) and artifact.html (%d KB)', Math.round(index.length / 1024), Math.round(artifact.length / 1024));
