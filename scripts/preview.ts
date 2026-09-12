import { join } from 'node:path'
const base = join(import.meta.dir, '..')
await Bun.build({ entrypoints: [join(base, 'scripts/preview-client.ts')], outdir: join(base, '.preview'), target: 'browser' })
const scene = (id: string) => {
  const night = id.includes('night'), warm = id.includes('train')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="${night ? '#222c54' : warm ? '#d6a578' : '#527f87'}"/><stop offset="1" stop-color="${night ? '#aa80ae' : '#edcda9'}"/></linearGradient></defs><rect width="640" height="480" fill="url(#sky)"/><circle cx="475" cy="95" r="42" fill="#f5dbad"/><path d="M0 270 140 165 320 310 440 225 640 285V480H0" fill="#344e59"/><path d="M0 330 190 278 390 350 640 290V480H0" fill="#1f353d"/><path d="M305 480 328 320 365 320 415 480" fill="#b08c70"/><path d="M240 480 250 298Q270 268 290 298L315 480" fill="#243145"/><circle cx="270" cy="274" r="18" fill="#ba8d6b"/><path d="M247 274Q245 240 270 245Q295 242 296 278L280 268 256 283" fill="#171f2c"/><path d="M250 308 210 365 228 373 266 330" fill="#2c3d53"/><g fill="#f8e4b9" opacity=".7"><circle cx="55" cy="58" r="2"/><circle cx="350" cy="43" r="2"/><circle cx="555" cy="200" r="2"/></g></svg>`
}
const server = Bun.serve({ hostname: '127.0.0.1', port: 4318, async fetch(req) {
  const url = new URL(req.url)
  if (url.pathname === '/') return new Response(await Bun.file(join(base, 'scripts/preview.html')).text(), { headers: { 'Content-Type': 'text/html' } })
  if (url.pathname === '/preview-client.js') return new Response(Bun.file(join(base, '.preview/preview-client.js')), { headers: { 'Content-Type': 'text/javascript' } })
  if (url.pathname.startsWith('/api/v1/images/') || url.pathname.startsWith('/api/v1/image-gen/results/')) return new Response(scene(url.pathname), { headers: { 'Content-Type': 'image/svg+xml' } })
  return new Response('Not found', { status: 404 })
} })
console.log(`Preview: ${server.url}`)
