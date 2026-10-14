// EdgeJournal build: esbuild (JS) + Tailwind v4 compile API (CSS) + static PWA files.
// Usage: node build.mjs            -> production build into dist/
//        node build.mjs --watch    -> rebuild on change + serve on http://localhost:5173
import * as esbuild from 'esbuild';
import { compile } from 'tailwindcss';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.dirname(new URL(import.meta.url).pathname);
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--watch');
const single = process.argv.includes('--single'); // one self-contained HTML file (demo)
const version = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 12);

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

async function buildCss() {
  const twBase = path.dirname(require.resolve('tailwindcss/package.json'));
  const input = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');
  const compiler = await compile(input, {
    base: path.join(root, 'src'),
    loadStylesheet: async (id, base) => {
      let p;
      if (id === 'tailwindcss') p = path.join(twBase, 'index.css');
      else if (id.startsWith('tailwindcss/')) p = path.join(twBase, id.slice(12) + (id.endsWith('.css') ? '' : '.css'));
      else p = path.resolve(base, id);
      return { path: p, base: path.dirname(p), content: fs.readFileSync(p, 'utf8') };
    },
  });
  const candidates = new Set();
  for (const f of walk(path.join(root, 'src'))) {
    if (!/\.(tsx?|jsx?|html)$/.test(f)) continue;
    const src = fs.readFileSync(f, 'utf8');
    for (const tok of src.split(/[\s"'`{}<>;]+/)) if (tok && tok.length < 120) candidates.add(tok);
  }
  return compiler.build([...candidates]);
}

async function buildJs() {
  const r = await esbuild.build({
    entryPoints: [path.join(root, 'src/main.tsx')],
    bundle: true,
    minify: !watch,
    sourcemap: watch ? 'inline' : false,
    format: 'esm',
    target: ['es2020', 'chrome100', 'safari15'],
    jsx: 'automatic',
    write: false,
    define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"', __APP_VERSION__: JSON.stringify(version) },
    logLevel: 'warning',
  });
  return r.outputFiles[0].text;
}

async function build() {
  const t = Date.now();
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
  const [js, css] = await Promise.all([buildJs(), buildCss()]);
  let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  if (single) {
    const icon = 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'public/icons/icon-192.png')).toString('base64');
    const jsS = js.replaceAll('./icons/icon-192.png', icon);
    html = html.replace('<title>EdgeJournal</title>', () => `<title>EdgeJournal</title>\n    <link rel="icon" href="${icon}" />`)
      .replace('<link rel="stylesheet" href="./assets/app.css" />', () => `<style>${css}</style>`)
      .replace('<script type="module" src="./assets/app.js"></script>', () => `<script type="module">${jsS.replace(/<\/script/gi, '<\\/script')}</script>`)
      .replace(/<link rel="manifest"[^>]*>\n?/, '')
      .replace(/<link rel="(apple-touch-icon|icon)" href="\.\/icons[^>]*>\n?/g, '');
    fs.writeFileSync(path.join(dist, 'index.html'), html);
  } else {
    fs.writeFileSync(path.join(dist, 'assets/app.js'), js);
    fs.writeFileSync(path.join(dist, 'assets/app.css'), css);
    fs.writeFileSync(path.join(dist, 'index.html'), html.replaceAll('__V__', version));
    for (const f of walk(path.join(root, 'public'))) {
      const rel = path.relative(path.join(root, 'public'), f);
      const to = path.join(dist, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      let content = fs.readFileSync(f);
      if (rel === 'sw.js') content = content.toString().replaceAll('__V__', version);
      fs.writeFileSync(to, content);
    }
  }
  console.log(`built ${single ? 'single-file ' : ''}dist/ v${version} in ${Date.now() - t}ms  (js ${(js.length / 1024).toFixed(0)}kB, css ${(css.length / 1024).toFixed(0)}kB)`);
}

await build();
if (watch) {
  let timer;
  fs.watch(path.join(root, 'src'), { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => build().catch((e) => console.error(e.message)), 150);
  });
  await import('./serve.mjs');
}
