/**
 * render-icons.mjs — the twelve service tiles as standalone PNGs.
 *
 * The architecture slide is built from native pptx shapes so its text stays real
 * text at real point sizes, but a stroked SVG glyph has no pptx equivalent worth
 * hand-writing. So each tile — rounded square, AWS category gradient, white
 * glyph — is rendered once here and placed as a picture.
 *
 * Glyphs and gradients are copied from public/agentcore-compare.html, which is
 * where this diagram started life, so the two artefacts stay recognisably the
 * same drawing.
 *
 *   node docs/slide-variants/render-icons.mjs
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'icons');

const TILE = {
  ink: '#232F3E',
  network: 'linear-gradient(135deg,#A16BFF,#8C4FFF)',
  storage: 'linear-gradient(135deg,#8FBF2A,#7AA116)',
  compute: 'linear-gradient(135deg,#FF9A3E,#ED7100)',
  ml: 'linear-gradient(135deg,#21C8AC,#01A88D)',
  core: 'linear-gradient(135deg,#3FD9BE,#01A88D)',
  db: 'linear-gradient(135deg,#7A9DFF,#527FFF)',
  mgmt: 'linear-gradient(135deg,#F5559B,#E7157B)',
};

const GLYPH = {
  browser: '<rect x="2.5" y="4" width="19" height="13" rx="1.5" /><path d="M8 20h8M12 17v3" />',
  cloudfront: '<circle cx="12" cy="12" r="8.2" /><ellipse cx="12" cy="12" rx="3.4" ry="8.2" /><path d="M3.9 9.4h16.2M3.9 14.6h16.2" />',
  s3: '<path d="M4.5 5.5h15l-1.7 13a1.4 1.4 0 0 1-1.4 1.2H7.6a1.4 1.4 0 0 1-1.4-1.2L4.5 5.5Z" /><path d="M3.4 5.5h17.2" />',
  alb: '<circle cx="5" cy="12" r="2.1" /><circle cx="19" cy="6.5" r="2.1" /><circle cx="19" cy="17.5" r="2.1" /><path d="M7.1 11.2 16.9 7.2M7.1 12.8l9.8 4" />',
  fargate: '<rect x="3" y="3.5" width="7.5" height="7.5" rx="1" /><rect x="13.5" y="3.5" width="7.5" height="7.5" rx="1" /><rect x="3" y="13" width="7.5" height="7.5" rx="1" /><rect x="13.5" y="13" width="7.5" height="7.5" rx="1" />',
  bedrock: '<path d="M12 3 3.2 7.6 12 12.2l8.8-4.6L12 3Z" /><path d="M3.2 12.3 12 16.9l8.8-4.6M3.2 16.6 12 21.2l8.8-4.6" />',
  dynamodb: '<ellipse cx="12" cy="5.8" rx="7.4" ry="2.9" /><path d="M4.6 5.8v12.4c0 1.6 3.3 2.9 7.4 2.9s7.4-1.3 7.4-2.9V5.8" /><path d="M4.6 12c0 1.6 3.3 2.9 7.4 2.9s7.4-1.3 7.4-2.9" />',
  cloudwatch: '<circle cx="12" cy="12" r="8.5" /><path d="M6.5 12.4h2.4l1.7-3.6 2.1 6.3 1.5-2.7h3.3" />',
  runtime: '<rect x="2.8" y="4" width="18.4" height="16" rx="2.6" /><path d="M2.8 9.2h18.4M8.6 14.6h6.8" /><circle cx="6" cy="6.6" r="0.85" />',
  memory: '<path d="M11.4 4.6c-2.5 0-4.4 1.9-4.4 4.2 0 .8.2 1.5.6 2.1-.6.7-1 1.6-1 2.6 0 2.3 1.9 4.1 4.2 4.1h.6V4.6Z" /><path d="M12.6 4.6c2.5 0 4.4 1.9 4.4 4.2 0 .8-.2 1.5-.6 2.1.6.7 1 1.6 1 2.6 0 2.3-1.9 4.1-4.2 4.1h-.6M12 4.6v13.1M12 20.4v-2.7" />',
  gateway: '<path d="M8.2 4 4 8.2v7.6L8.2 20M15.8 4 20 8.2v7.6L15.8 20" /><circle cx="12" cy="12" r="2.5" /><path d="M12 4v5M12 15v5" />',
  lambda: '<path d="M3.6 20 11.7 4h3.1" /><path d="M10.1 20 14.9 10.2 20.4 20" />',
};

/** name → [glyph key, tile key]. One entry per tile the slide places. */
const TILES = {
  browser: ['browser', 'ink'],
  cloudfront: ['cloudfront', 'network'],
  alb: ['alb', 'network'],
  s3: ['s3', 'storage'],
  fargate: ['fargate', 'compute'],
  lambda: ['lambda', 'compute'],
  bedrock: ['bedrock', 'ml'],
  dynamodb: ['dynamodb', 'db'],
  cloudwatch: ['cloudwatch', 'mgmt'],
  runtime: ['runtime', 'core'],
  memory: ['memory', 'core'],
  gateway: ['gateway', 'core'],
  // AgentCore Observability has no glyph of its own — it lands in CloudWatch, so
  // it borrows CloudWatch's, on an AgentCore-teal tile.
  observability: ['cloudwatch', 'core'],
};

// 72px at deviceScaleFactor 4 → 288px, which is ~650 dpi for a 0.44in tile.
const SIZE = 72;
// Heavier than the 1.7 the web diagram uses: the same glyph has to survive being
// projected, and a hairline is the first thing a projector loses.
const STROKE = 2.1;

const cells = Object.entries(TILES).map(([name, [g, t]]) => `
  <div class="tile" id="${name}" style="background:${TILE[t]}">
    <svg width="${SIZE * 0.7}" height="${SIZE * 0.7}" viewBox="0 0 24 24" fill="none"
         stroke="#fff" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round">
      ${GLYPH[g]}
    </svg>
  </div>`).join('');

const html = `<!doctype html><meta charset="utf-8"><style>
  body { margin:0; background:transparent; display:flex; flex-wrap:wrap; gap:8px; }
  .tile { width:${SIZE}px; height:${SIZE}px; border-radius:${SIZE * 0.22}px;
          display:flex; align-items:center; justify-content:center; }
</style>${cells}`;

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 700, height: 400 }, deviceScaleFactor: 4 });
await page.setContent(html);
for (const name of Object.keys(TILES)) {
  await page.locator('#' + name).screenshot({
    path: path.join(OUT, name + '.png'),
    omitBackground: true,
  });
}
await browser.close();
console.log('wrote', Object.keys(TILES).length, 'tiles to', OUT);
