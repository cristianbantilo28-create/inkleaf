// The [[headers]] rules from netlify.toml, so the local test servers send what Netlify sends
// (the Content-Security-Policy in particular). Usage: const h = netlifyHeaders(root); h('/index.html') → { ... }
import fs from 'node:fs';
import path from 'node:path';

export function netlifyHeaders(root) {
  const toml = fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8');
  const rules = [];
  for (const m of toml.matchAll(/\[\[headers\]\]\s*\n\s*for = "([^"]+)"\s*\n\s*\[headers\.values\]\s*\n((?:[ \t]*[\w-]+ = "(?:[^"\\]|\\.)*"[ \t]*\n?)+)/g)) {
    const values = {};
    for (const v of m[2].matchAll(/([\w-]+) = "((?:[^"\\]|\\.)*)"/g)) values[v[1]] = v[2].replace(/\\"/g, '"');
    rules.push({ pattern: m[1], values });
  }
  const matches = (pattern, p) => pattern === '/*' ? true : pattern.endsWith('/*') ? p.startsWith(pattern.slice(0, -1)) : pattern === p;
  return p => { const h = {}; for (const r of rules) if (matches(r.pattern, p)) Object.assign(h, r.values); return h; };
}

// What Netlify adds to the pages of free-plan sites: an inline script that draws the "Powered by Netlify" badge.
// The test servers add a stand-in so the suites prove the policy keeps it out while the app's own scripts run.
export const FAKE_BADGE = `<script>window.__netlifyBadge = true; document.body.insertAdjacentHTML('beforeend', '<div id="netlify-badge">Powered by Netlify</div>');</script>`;
