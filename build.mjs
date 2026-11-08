// Збірка Rent·Control.
//   node build.mjs          → dist/ (для Vercel: index.html + assets/ з хешами)
//   node build.mjs --demo   → dist-demo/index.html (один файл, фейковий Notion, для перегляду без Telegram)
import * as esbuild from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'

const DEMO = process.argv.includes('--demo')
const root = path.dirname(new URL(import.meta.url).pathname)
const outdir = path.join(root, DEMO ? 'dist-demo' : 'dist')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const builtAt = new Date().toISOString()

fs.rmSync(outdir, { recursive: true, force: true })
fs.mkdirSync(outdir, { recursive: true })

const result = await esbuild.build({
  entryPoints: { app: path.join(root, DEMO ? 'dev/demo.jsx' : 'src/main.jsx') },
  bundle: true,
  minify: true,
  format: 'esm',
  target: ['es2020', 'safari15', 'chrome90'],
  jsx: 'automatic',
  outdir: path.join(outdir, 'assets'),
  entryNames: DEMO ? '[name]' : '[name]-[hash]',
  assetNames: '[name]-[hash]',
  publicPath: '/assets',
  loader: { '.woff': DEMO ? 'dataurl' : 'file', '.svg': 'text' },
  define: {
    'process.env.NODE_ENV': '"production"',
    __DEMO__: DEMO ? 'true' : 'false',
    __VERSION__: JSON.stringify(pkg.version),
    __BUILT_AT__: JSON.stringify(builtAt),
  },
  legalComments: 'none',
  metafile: true,
  write: true,
  logLevel: 'warning',
})

const outputs = Object.keys(result.metafile.outputs).map(p => path.relative(path.join(outdir, 'assets'), p))
const js = outputs.find(f => /^app(-[A-Z0-9]+)?\.js$/i.test(f))
const css = outputs.find(f => /^app(-[A-Z0-9]+)?\.css$/i.test(f))
if (!js) throw new Error('JS bundle not found')

let html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8')
if (DEMO) {
  const jsCode = fs.readFileSync(path.join(outdir, 'assets', js), 'utf8').replace(/<\/script>/g, '<\\/script>')
  const cssCode = css ? fs.readFileSync(path.join(outdir, 'assets', css), 'utf8') : ''
  html = html
    .replace('<!--TELEGRAM-->', '')
    .replace('<!--CSS-->', `<style>${cssCode}</style>`)
    .replace('<!--JS-->', `<script type="module">${jsCode}</script>`)
  fs.rmSync(path.join(outdir, 'assets'), { recursive: true, force: true })
} else {
  html = html
    .replace('<!--TELEGRAM-->', '<script src="https://telegram.org/js/telegram-web-app.js?59"></script>')
    .replace('<!--CSS-->', css ? `<link rel="stylesheet" href="/assets/${css}">` : '')
    .replace('<!--JS-->', `<script type="module" src="/assets/${js}"></script>`)
  // статичні файли (іконка тощо)
  const pub = path.join(root, 'public')
  for (const f of fs.readdirSync(pub)) {
    const p = path.join(pub, f)
    if (fs.statSync(p).isFile()) fs.copyFileSync(p, path.join(outdir, f))
  }
}
fs.writeFileSync(path.join(outdir, 'index.html'), html)

const size = f => (fs.statSync(path.join(outdir, 'assets', f)).size / 1024).toFixed(1) + ' KB'
if (DEMO) console.log(`demo → ${path.join(outdir, 'index.html')} (${(fs.statSync(path.join(outdir, 'index.html')).size / 1024).toFixed(0)} KB)`)
else console.log(`build ${pkg.version} → dist/  js ${size(js)}${css ? `  css ${size(css)}` : ''}`)
