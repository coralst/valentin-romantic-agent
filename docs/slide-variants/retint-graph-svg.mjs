/* retint-graph-svg.mjs — writes an AWS-palette copy of the generated agent
   contribution graph. The original is produced by scripts/generate-agent-graph.py
   from live PR history and keeps the Valentin palette for public/deck-v2.html; this
   copy exists only so the slide can sit in the AWS-templated pptx.
       node docs/slide-variants/retint-graph-svg.mjs <outFile>
   Colour keys mirror the --master/--arch/--front/--back/--design/--qa remap in
   aws-retint.css, so the graph and the team slide agree on who is what colour. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const SRC = resolve(ROOT, 'public/deck-assets/agent-contribution-graph.svg');
const OUT = resolve(process.argv[2] || '/tmp/agent-contribution-graph-aws.svg');

const MAP = {
  '#EFE7E1': '#F7F8FA', // warm cream ground -> AWS panel grey
  '#2A2226': '#16191F', // ink
  '#7C7378': '#545B64', // secondary grey
  '#756A70': '#545B64', // caption grey
  '#7B68EE': '#FF9900', // master agent
  '#FF8C00': '#232F3E', // system architect
  '#1E90FF': '#0972D3', // frontend dev
  '#32CD32': '#1E7C3C', // backend dev
  '#FF69B4': '#7D3C98', // ui designer
  '#FF4500': '#C7500F', // qa agent
  '#A8762B': '#B7791F', // "worth reading" star
};

let svg = readFileSync(SRC, 'utf8');
const counts = {};
for (const [from, to] of Object.entries(MAP)) {
  const re = new RegExp(from, 'gi');
  counts[from] = (svg.match(re) || []).length;
  svg = svg.replace(re, to);
}
svg = svg.replace(
  /font-family="-apple-system[^"]*"/g,
  'font-family="Amazon Ember,Helvetica Neue,Arial,sans-serif"',
);
writeFileSync(OUT, svg);
console.log('wrote', OUT);
console.log(Object.entries(counts).map(([k, v]) => `${k}->${MAP[k]} x${v}`).join('  '));
const left = [...new Set(svg.match(/#[0-9A-Fa-f]{6}/g) || [])].filter(
  (c) => !Object.values(MAP).includes(c.toUpperCase()) && !Object.values(MAP).includes(c));
console.log('unmapped colours left:', left.join(' ') || '(none)');
