/**
 * Render the deck's diagram assets to PNG: the agent-persona strip, the PR
 * contribution graph, and the three Mermaid diagrams from the README /
 * METHODOLOGY. PowerPoint cannot place SVG reliably, hence the raster step.
 *
 * Usage: npx tsx scripts/render-deck-diagrams.mts
 */
import { chromium, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = 'docs/deck-assets';

/** SVG files rendered at 2x for crisp projection. */
const SVGS = [
  { file: 'docs/assets/agents/team.svg', out: 'team-strip.png', w: 636, h: 100 },
  { file: 'docs/assets/graph/agent-contribution-graph.svg', out: 'contribution-graph.png', w: 2700, h: 762 },
];

const ORG_CHART = `flowchart TD
    H["HUMAN — product intent · final say · veto"]
    M["MASTER AGENT — Orchestrator<br/>decomposes · delegates · reviews · merges"]
    H -->|"a feature request, in prose"| M
    M -.->|"invokeSubAgent()"| A
    M -.->|"invokeSubAgent()"| F
    M -.->|"invokeSubAgent()"| B
    M -.->|"invokeSubAgent()"| D
    M -.->|"invokeSubAgent()"| Q
    A["SYSTEM ARCHITECT<br/>contracts · shared types<br/><code>src/shared/</code>"]
    F["FRONTEND DEV<br/>components · hooks<br/><code>src/client/</code>"]
    B["BACKEND DEV<br/>API · extraction<br/><code>src/server/</code>"]
    D["UI DESIGNER<br/>tokens · a11y<br/><code>design-system/</code>"]
    Q["QA AGENT<br/>Playwright E2E<br/><code>e2e/</code>"]
    A ==>|returns| M
    F ==>|returns| M
    B ==>|returns| M
    D ==>|returns| M
    Q ==>|returns| M
    classDef human fill:#1f2328,stroke:#6E7781,stroke-width:2px,color:#fff
    classDef master fill:#7B68EE,stroke:#5a4bc4,stroke-width:3px,color:#fff
    classDef arch fill:#FF8C00,stroke:#cc7000,stroke-width:2px,color:#fff
    classDef front fill:#1E90FF,stroke:#1873cc,stroke-width:2px,color:#fff
    classDef back fill:#32CD32,stroke:#28a428,stroke-width:2px,color:#fff
    classDef design fill:#FF69B4,stroke:#cc5490,stroke-width:2px,color:#fff
    classDef qa fill:#FF4500,stroke:#cc3700,stroke-width:2px,color:#fff
    class H human
    class M master
    class A arch
    class F front
    class B back
    class D design
    class Q qa`;

const LIFECYCLE = `flowchart LR
    P1["<b>1 · SPEC</b><br/>Master opens an Issue<br/>tags Architect for a spec<br/>approves or requests changes"]
    P2["<b>2 · BRANCH</b><br/>Feature branch + Draft PR<br/>per assigned agent<br/>each carrying <code>Resolves #N</code>"]
    P3["<b>3 · BUILD + REVIEW</b><br/>Agents push incrementally<br/>Master drives the review loop<br/><i>repeats until resolved</i>"]
    P4["<b>4 · CI</b><br/>Master verifies Actions green<br/>Lint · Unit · Build · E2E"]
    P5["<b>5 · MERGE</b><br/>APPROVED-BY-MASTER-AGENT<br/>merge, then delete branch"]
    P1 --> P2 --> P3 --> P4 --> P5
    P3 -.->|"another round"| P3
    P4 -.->|"red"| P3
    classDef phase fill:#7B68EE,stroke:#5a4bc4,stroke-width:2px,color:#fff
    classDef gate fill:#32CD32,stroke:#28a428,stroke-width:2px,color:#fff
    class P1,P2,P3 phase
    class P4,P5 gate`;

const SEQUENCE = `sequenceDiagram
    autonumber
    participant M as Master
    participant B as Backend Dev
    participant Q as QA Agent
    participant G as Merge Gate
    Note over M: reviews the diff + CI
    M->>M: posts review comment<br/>tagging @backend-dev @qa-agent
    par genuine multi-agent fan-out
        M->>+B: invokeSubAgent(prNumber, reviewBody)
        B->>B: pushes fix commits
        B->>B: replies, tagging @master-agent
        B-->>-M: returns
    and
        M->>+Q: invokeSubAgent(prNumber, reviewBody)
        Q->>Q: runs E2E suite, adds coverage
        Q->>Q: replies, tagging @master-agent
        Q-->>-M: returns
    end
    Note over M: reads every return, then decides
    alt blocking issues remain
        M->>B: another round — tag + invoke again
    else resolved
        M->>M: posts APPROVED-BY-MASTER-AGENT
        M->>+G: merge_pull_request
        G->>G: lastWordIsMaster? / allTaggedResponded? / ciGreen?
        G-->>-M: merge permitted
    end`;

const DIAGRAMS = [
  { def: ORG_CHART, out: 'diagram-org-chart.png' },
  { def: LIFECYCLE, out: 'diagram-lifecycle.png' },
  { def: SEQUENCE, out: 'diagram-sequence.png' },
];

async function renderMermaid(page: Page, def: string, out: string) {
  await page.setContent(`<!DOCTYPE html><html><body style="margin:0;background:#fff">
    <div id="host" style="display:inline-block;padding:16px"></div></body></html>`);
  await page.evaluate(async (definition) => {
    const mermaid = (await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs')).default;
    mermaid.initialize({ startOnLoad: false, theme: 'default' });
    const { svg } = await mermaid.render('graph', definition);
    const host = document.getElementById('host')!;
    host.innerHTML = svg;
    // Mermaid sizes to its own intrinsic width, which is far too small to
    // project. Widen the SVG before the screenshot so the raster is crisp.
    const el = host.querySelector('svg')!;
    el.style.maxWidth = 'none';
    el.style.width = '1800px';
    el.style.height = 'auto';
    el.setAttribute('width', '1800');
  }, def);
  await page.waitForSelector('#host svg');
  await page.locator('#host').screenshot({ path: `${OUT}/${out}` });
  console.log(`rendered ${out}`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  const svgPage = await browser.newPage({ deviceScaleFactor: 2 });
  for (const { file, out, w, h } of SVGS) {
    await svgPage.setViewportSize({ width: w, height: h });
    await svgPage.goto(`file://${resolve(file)}`);
    await svgPage.waitForTimeout(400);
    await svgPage.screenshot({ path: `${OUT}/${out}` });
    console.log(`rendered ${out}`);
  }

  const mmdPage = await browser.newPage({ viewport: { width: 1800, height: 1200 }, deviceScaleFactor: 2 });
  for (const { def, out } of DIAGRAMS) {
    await renderMermaid(mmdPage, def, out);
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
