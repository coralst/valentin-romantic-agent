import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  colors,
  typography,
  spacing,
  animation,
  borderRadius,
  shadows,
  breakpoints,
  insets,
  radii,
  layout,
} from './tokens';

describe('design tokens', () => {
  it('exports all expected token groups', () => {
    expect(colors).toBeDefined();
    expect(typography).toBeDefined();
    expect(spacing).toBeDefined();
    expect(animation).toBeDefined();
    expect(borderRadius).toBeDefined();
    expect(shadows).toBeDefined();
    expect(breakpoints).toBeDefined();
  });

  it('all color tokens are valid hex, CSS color, or gradient values', () => {
    const validColor = /^#[0-9A-Fa-f]{3,8}$|^rgb|^hsl|^linear-gradient|^[a-z]+$/;
    for (const [key, value] of Object.entries(colors)) {
      expect(value, `colors.${key} should be a valid color`).toMatch(validColor);
    }
  });

  it('typography defines serif heading and sans-serif body font families', () => {
    expect(typography.headingFontFamily).toContain('serif');
    expect(typography.bodyFontFamily).toContain('sans-serif');
  });

  it('spacing tokens follow 8px grid', () => {
    for (const [key, value] of Object.entries(spacing)) {
      expect(value % 8, `spacing.${key} should be a multiple of 8`).toBe(0);
    }
  });

  it('animation durations are between 200ms and 400ms', () => {
    for (const [key, value] of Object.entries(animation.durations)) {
      expect(value, `animation.durations.${key}`).toBeGreaterThanOrEqual(200);
      expect(value, `animation.durations.${key}`).toBeLessThanOrEqual(400);
    }
  });

  it('breakpoints defines mobile threshold', () => {
    expect(breakpoints.mobile).toBe(930);
  });

  it('the mobile breakpoint leaves the collapsed shell its minimum chat column', () => {
    // The same derivation as `conversationList` below, one step further in: with the
    // list column already yielded, this is everything left that cannot compress. Was
    // 768 — a phone-vs-tablet number, not a fact about this shell — which left the
    // desktop tree rendering at 768 and 1024 with ~250px of usable measure.
    const fixedChrome = 2 * insets.tight + layout.iconRailWidth + layout.briefRailWidth;

    expect(breakpoints.mobile - fixedChrome).toBeGreaterThanOrEqual(layout.chatColumnMinWidth);
  });

  it('keeps the two breakpoints in the right order', () => {
    // Between them the desktop shell runs without its list column. If mobile ever
    // rose above this, that middle band would have no layout at all.
    expect(breakpoints.mobile).toBeLessThan(breakpoints.conversationList);
  });

  it('breakpoints defines the conversation-list threshold above mobile', () => {
    expect(breakpoints.conversationList).toBe(1160);
    // Between the two the shell is still the desktop one, minus the list column.
    expect(breakpoints.conversationList).toBeGreaterThan(breakpoints.mobile);
  });

  it('the conversation-list breakpoint leaves the chat column its minimum', () => {
    // The derivation the breakpoint's value comes from: everything in the chat
    // shell that cannot compress. If any of these tracks grows, this fails and the
    // breakpoint has to move with it.
    const fixedChrome =
      2 * insets.tight +
      layout.iconRailWidth +
      layout.conversationListWidth +
      layout.briefRailWidth;

    expect(breakpoints.conversationList - fixedChrome).toBeGreaterThanOrEqual(
      layout.chatColumnMinWidth,
    );
  });

  it('colors includes semantic tokens', () => {
    expect(colors.agentBubble).toBeDefined();
    expect(colors.userBubble).toBeDefined();
    expect(colors.background).toBeDefined();
    expect(colors.text).toBeDefined();
    expect(colors.border).toBeDefined();
    expect(colors.highlight).toBeDefined();
  });
});

/**
 * The vitrine mockups (option-5d-brief.html, full-profile.html) are a locked
 * design. These are regression tests: if a value here changes, the code has
 * drifted from the approved design and the mockup must be re-approved first.
 */
describe('vitrine design tokens', () => {
  it('claret/gold palette matches the mockups verbatim', () => {
    expect(colors.claret).toBe('#8C2F45');
    expect(colors.claretLight).toBe('#B14A62');
    expect(colors.gold).toBe('#B08C4F');
    expect(colors.goldLight).toBe('#C09A5E');
    expect(colors.olive).toBe('#7C8464');
    expect(colors.petal).toBe('#F6DEE2');
    expect(colors.porcelain).toBe('#FFFDFB');
    expect(colors.linen).toBe('#EFE7E1');
    expect(colors.linenShade).toBe('#E5D9D2');
    expect(colors.sand).toBe('#FAF4F0');
    expect(colors.ink).toBe('#2A2226');
    expect(colors.inkMuted).toBe('#756A70');
    expect(colors.inkFaint).toBe('#A3959C');
    expect(colors.onClaret).toBe('#FBEFF1');
    expect(colors.onGold).toBe('#4A1826');
  });

  it('vitrine gradients match the mockups verbatim', () => {
    expect(colors.railGradient).toBe('linear-gradient(178deg, #7C2A3D 0%, #5A1E2D 100%)');
    expect(colors.nudgeGradient).toBe(
      'linear-gradient(165deg, #DFB877 0%, #C09A5E 55%, #A8834A 100%)',
    );
    expect(colors.meterGradient).toBe('linear-gradient(90deg, #B14A62, #8C2F45)');
    expect(colors.hairlineGradient).toBe(
      'linear-gradient(90deg, transparent, #E5D9D2 10%, #E5D9D2 90%, transparent)',
    );
    expect(colors.spineGradient).toBe('linear-gradient(#E5D9D2, transparent)');
    expect(colors.vitrineSayGradient).toBe('linear-gradient(100deg, #FBF3E8, #FDF7F0)');
  });

  it('the vitrine colors satisfy the same color format contract as the rest', () => {
    const validColor = /^#[0-9A-Fa-f]{3,8}$|^rgb|^hsl|^linear-gradient|^[a-z]+$/;
    const vitrineKeys = [
      'claret',
      'claretLight',
      'gold',
      'goldLight',
      'olive',
      'petal',
      'porcelain',
      'linen',
      'linenShade',
      'sand',
      'ink',
      'inkMuted',
      'inkFaint',
      'onClaret',
      'onGold',
      'railGradient',
      'nudgeGradient',
      'meterGradient',
      'hairlineGradient',
      'spineGradient',
      'vitrineSayGradient',
    ] as const;
    for (const key of vitrineKeys) {
      expect(colors[key], `colors.${key} should be a valid color`).toMatch(validColor);
    }
  });

  it('typography adopts Gloock/Outfit while keeping the previous faces as fallbacks', () => {
    expect(typography.headingFontFamily).toContain('Gloock');
    expect(typography.headingFontFamily).toContain('Playfair Display');
    expect(typography.headingFontFamily).toContain('serif');
    expect(typography.bodyFontFamily).toContain('Outfit');
    expect(typography.bodyFontFamily).toContain('Inter');
    expect(typography.bodyFontFamily).toContain('sans-serif');
  });

  it('typography.px carries the mockups optical sizes, including half-pixel steps', () => {
    expect(typography.px.eyebrow).toBe(9);
    expect(typography.px.caption).toBe(10.5);
    expect(typography.px.labelLoose).toBe(11.5);
    expect(typography.px.smallLoose).toBe(12.5);
    expect(typography.px.bodyLoose).toBe(13.5);
    expect(typography.px.chat).toBe(14.5);
    expect(typography.px.headingSm).toBe(17);
    expect(typography.px.headingMd).toBe(19);
    expect(typography.px.headingXl).toBe(22);
    expect(typography.px.display).toBe(25);
  });

  /**
   * The landing page's wordmark. It sits outside the app window, so it is the
   * one size with no in-app counterpart — and the reason it is a token at all is
   * that the alternative was a magic 46 inlined in one component.
   */
  it('typography.px.hero is larger than anything inside the app window', () => {
    expect(typography.px.hero).toBe(46);

    const inWindow = Object.entries(typography.px).filter(([key]) => key !== 'hero');
    for (const [key, value] of inWindow) {
      expect(typography.px.hero, `hero must exceed px.${key}`).toBeGreaterThan(value);
    }
  });

  it('every typography.px value is a positive number', () => {
    for (const [key, value] of Object.entries(typography.px)) {
      expect(value, `typography.px.${key} must be positive`).toBeGreaterThan(0);
    }
  });

  it('insets carry the 14/18/26 vitrine rhythm', () => {
    expect(insets).toEqual({ tight: 14, snug: 18, roomy: 26 });
  });

  it('radii match the mockup corner values', () => {
    expect(radii.window).toBe(34);
    expect(radii.card).toBe(26);
    expect(radii.panel).toBe(18);
    expect(radii.chip).toBe(16);
    expect(radii.icon).toBe(14);
    expect(radii.kv).toBe(13);
    expect(radii.tail).toBe(8);
    expect(radii.pill).toBe(9999);
  });

  it('layout carries the mockup shell dimensions', () => {
    expect(layout.iconRailWidth).toBe(76);
    expect(layout.conversationListWidth).toBe(226);
    expect(layout.briefRailWidth).toBe(306);
    expect(layout.meterWidth).toBe(176);
    expect(layout.iconButtonSize).toBe(42);
    expect(layout.crestSize).toBe(46);
    expect(layout.cameoSize).toBe(56);
    expect(layout.chatColumnMaxWidth).toBe(620);
    expect(layout.chatColumnMinWidth).toBe(520);
    expect(layout.menuWidth).toBe(268);
    expect(layout.menuControlHeight).toBe(38);
  });

  /**
   * The chat column's two bounds, as a relationship. A minimum above the maximum
   * would mean the column had no legal width at all, and the breakpoint derived
   * from the minimum would be arguing with the measure derived from the maximum.
   *
   * There is no longer a `windowMaxWidth` to check the shell against: the frame
   * fills whatever window it is given, so the only ceiling is the screen.
   */
  it('the chat column may not be floored above its own cap', () => {
    expect(layout.chatColumnMinWidth).toBeLessThan(layout.chatColumnMaxWidth);
  });

  /**
   * The ⚙ menu's controls share one height, which is what stops them reading as
   * four unrelated buttons. Pinned as a relationship rather than as two numbers
   * so a future taller control cannot quietly outgrow the row it sits in.
   */
  it('the menu control fits inside a menu-width column with room to spare', () => {
    expect(layout.menuControlHeight).toBeLessThan(layout.iconButtonSize);
    expect(layout.menuWidth).toBeGreaterThan(layout.iconRailWidth);
  });

  it('insets, radii and layout are all positive integers', () => {
    for (const scale of [
      ['insets', insets],
      ['radii', radii],
      ['layout', layout],
    ] as const) {
      const [name, values] = scale;
      for (const [key, value] of Object.entries(values)) {
        expect(value, `${name}.${key} must be a positive integer`).toBeGreaterThan(0);
        expect(Number.isInteger(value), `${name}.${key} must be an integer`).toBe(true);
      }
    }
  });

  it('the vitrine scales are separate from spacing, which keeps its 8px contract', () => {
    // insets deliberately breaks the 8px grid, which is exactly why it is its
    // own export rather than extra keys on `spacing`.
    expect(Object.values(insets).some((value) => value % 8 !== 0)).toBe(true);
    for (const value of Object.values(spacing)) {
      expect(value % 8).toBe(0);
    }
  });
});

describe('Property 11: Design token constraints', () => {
  const spacingEntries = Object.entries(spacing) as [string, number][];
  const durationEntries = Object.entries(animation.durations) as [string, number][];

  it('for any spacing token, its numeric value is a positive multiple of 8', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...spacingEntries),
        ([key, value]) => {
          expect(value, `spacing.${key} must be positive`).toBeGreaterThan(0);
          expect(value % 8, `spacing.${key} must be a multiple of 8`).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('for any inset, radius or layout token, its value is a positive integer', () => {
    const vitrineEntries = [
      ...Object.entries(insets).map(([k, v]) => [`insets.${k}`, v] as [string, number]),
      ...Object.entries(radii).map(([k, v]) => [`radii.${k}`, v] as [string, number]),
      ...Object.entries(layout).map(([k, v]) => [`layout.${k}`, v] as [string, number]),
    ];

    fc.assert(
      fc.property(fc.constantFrom(...vitrineEntries), ([key, value]) => {
        expect(value, `${key} must be positive`).toBeGreaterThan(0);
        expect(Number.isInteger(value), `${key} must be an integer`).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('for any animation duration token, its value is between 200ms and 400ms inclusive', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...durationEntries),
        ([key, value]) => {
          expect(value, `animation.durations.${key} >= 200`).toBeGreaterThanOrEqual(200);
          expect(value, `animation.durations.${key} <= 400`).toBeLessThanOrEqual(400);
        },
      ),
      { numRuns: 100 },
    );
  });
});
