/**
 * Design tokens for Valentin — modern, warm, sophisticated romantic palette.
 * All spacing values follow an 8px grid. Animation durations stay within 200–400ms.
 */

export const colors = {
  // Core palette
  dustyRose: '#D4A0A8',
  champagne: '#F7EDE2',
  softBurgundy: '#9B3A52',
  warmIvory: '#FDFAF7',
  warmTaupe: '#B8A99A',
  deepPlum: '#5C2434',
  blush: '#F2D4D8',
  cream: '#FFF9F5',

  // Semantic tokens
  agentBubble: '#FFFFFF',
  userBubble: '#9B3A52',
  userBubbleText: '#FFFFFF',
  background: '#F8F5F2',
  surface: '#FFFFFF',
  surfaceElevated: 'rgba(255, 255, 255, 0.85)',
  text: '#2D2024',
  textSecondary: '#8A7A7E',
  textOnAccent: '#FFFFFF',
  border: '#EDE6E0',
  borderSubtle: '#F2ECE7',
  highlight: '#F2D4D8',
  error: '#D94452',
  success: '#4A9B6A',

  // Gradient accents
  accentGradient: 'linear-gradient(135deg, #9B3A52 0%, #C4566E 100%)',
  headerGradient: 'linear-gradient(180deg, rgba(255,255,255,0.95) 0%, rgba(248,245,242,0.9) 100%)',

  // ---------------------------------------------------------------------------
  // Vitrine palette — from the `:root` blocks of option-5d-brief.html and
  // full-profile.html. Purely additive: no key above changes value, because 24
  // files import this module and read the older names.
  // ---------------------------------------------------------------------------

  // Claret — the brand red of the icon rail, the user's bubbles and every CTA.
  claret: '#8C2F45',
  claretLight: '#B14A62',

  // Gold — carries deadlines, counts, and Valentin's own pinned prompt.
  gold: '#B08C4F',
  goldLight: '#C09A5E',

  // Supporting hues.
  olive: '#7C8464',
  petal: '#F6DEE2',

  // Ink-moss — the ground of the architecture rail across the foot of the window.
  //
  // Deliberately *not* another red. The icon rail, the user's bubbles, every CTA
  // and the brief's meter already carry the claret; a third saturated red band
  // along the bottom flattened the frame into a single hue. Moss is a warm
  // green-grey rather than a cool slate, so it still belongs to a linen-and-gold
  // room, and it sits with `gold` instead of competing with `claret`.
  moss: '#333A2E',
  mossGradient: 'linear-gradient(180deg, #3E4636 0%, #2F3629 100%)',
  /** Copy and hairlines used *on* the moss rail. */
  onMoss: '#EAE7D6',
  onMossMuted: 'rgba(234, 231, 214, 0.62)',
  onMossHairline: 'rgba(234, 231, 214, 0.16)',
  /** The rail's "live" pip: readable on moss, where a saturated teal muddied. */
  jade: '#7FC9A6',

  // Neutrals: porcelain (panel white) → linen (app ground) → linenShade (hairline).
  porcelain: '#FFFDFB',
  linen: '#EFE7E1',
  linenShade: '#E5D9D2',
  sand: '#FAF4F0',

  // Ink ramp: primary copy → secondary copy → faint uppercase eyebrow labels.
  ink: '#2A2226',
  inkMuted: '#756A70',
  inkFaint: '#A3959C',

  // Copy colours used *on* the dark claret rail and *on* the gold nudge.
  onClaret: '#FBEFF1',
  onGold: '#4A1826',

  // Vitrine gradients.
  railGradient: 'linear-gradient(178deg, #7C2A3D 0%, #5A1E2D 100%)',
  nudgeGradient: 'linear-gradient(165deg, #DFB877 0%, #C09A5E 55%, #A8834A 100%)',
  meterGradient: 'linear-gradient(90deg, #B14A62, #8C2F45)',
  hairlineGradient:
    'linear-gradient(90deg, transparent, #E5D9D2 10%, #E5D9D2 90%, transparent)',
  spineGradient: 'linear-gradient(#E5D9D2, transparent)',
  vitrineSayGradient: 'linear-gradient(100deg, #FBF3E8, #FDF7F0)',
} as const;

export const typography = {
  // Gloock + Outfit are the vitrine faces. The previous families are kept as
  // fallbacks, so an offline or blocked-webfont render degrades to the old look
  // rather than to a system default.
  headingFontFamily: "'Gloock', 'Playfair Display', Georgia, serif",
  bodyFontFamily: "'Outfit', 'Inter', sans-serif",
  /**
   * Optical pixel sizes taken verbatim from the mockups. These exist alongside
   * `sizes` because the rem scale below cannot express the half-pixel steps the
   * mockups rely on for their uppercase eyebrow labels and dense chips.
   */
  px: {
    eyebrow: 9,
    eyebrowWide: 9.5,
    micro: 8.5,
    tiny: 10,
    caption: 10.5,
    label: 11,
    labelLoose: 11.5,
    small: 12,
    smallLoose: 12.5,
    body: 13,
    bodyLoose: 13.5,
    bodyLarge: 14,
    chat: 14.5,
    control: 15,
    headingSm: 17,
    headingMd: 19,
    headingLg: 20,
    headingXl: 22,
    display: 25,
    /**
     * The landing page wordmark, and nothing else.
     *
     * Every other size here is a measurement of something inside the app window,
     * where 25 is already the largest thing on screen. The landing page has no
     * window and no competing content, so its wordmark carries the whole page —
     * a size the in-app scale has no reason to contain.
     */
    hero: 46,
  },
  sizes: {
    xs: '0.75rem',
    sm: '0.875rem',
    base: '0.9375rem',
    md: '1.0625rem',
    lg: '1.25rem',
    xl: '1.5rem',
    xxl: '2rem',
  },
  weights: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  lineHeights: {
    tight: 1.25,
    normal: 1.5,
    relaxed: 1.75,
  },
} as const;

export const spacing = {
  xs: 8,
  sm: 16,
  md: 24,
  lg: 32,
  xl: 40,
  xxl: 48,
} as const;

/**
 * Vitrine padding rhythm, in px. The mockups breathe on a 14/18/26 beat, which
 * is not expressible on the 8px grid that `spacing` is contractually held to
 * (see tokens.test.ts). Rather than relax that contract or round the design,
 * the two scales coexist: `spacing` for the legacy 8px components, `insets` for
 * vitrine surfaces.
 */
export const insets = {
  tight: 14,
  snug: 18,
  roomy: 26,
} as const;

/**
 * Corner radii, in px, named for the surface each one belongs to.
 * `window` is the outer app frame, `card` the profile cards and chat bubbles,
 * `panel` the nudge, `chip` the conversation rows, `kv` the key/value tiles.
 */
export const radii = {
  window: 34,
  card: 26,
  panel: 18,
  chip: 16,
  icon: 14,
  kv: 13,
  /** The tight corner on a bubble's "tail" side. */
  tail: 8,
  pill: 9999,
} as const;

/**
 * Fixed layout dimensions, in px — column widths and control sizes lifted from
 * the mockups' grid template and element boxes.
 *
 * These live in their own export rather than in `radii`/`insets` because they
 * are a different kind of value: a radius or an inset is a style you may apply
 * to any surface, whereas these are one-off measurements of specific named
 * regions of the shell. Mixing them in would make `radii.rail` read as "the
 * rail's corner radius" when it means the rail's width.
 */
export const layout = {
  /** Grid columns of the app window: rail | list | chat | brief. */
  iconRailWidth: 76,
  conversationListWidth: 226,
  briefRailWidth: 306,
  /** Meter in the full-profile header. */
  meterWidth: 176,
  /** Control and portrait sizes. */
  iconButtonSize: 42,
  crestSize: 46,
  cameoSize: 56,
  headerFaceSize: 50,
  messageAvatarSize: 32,
  sendButtonSize: 40,
  backButtonSize: 36,
  /**
   * The rail's ⚙ menu: one column of full-width controls.
   *
   * A width and a control height rather than "whatever the buttons need": the
   * menu is portalled out of the 76px rail, so nothing constrains it, and left
   * to shrink-wrap its contents the four controls wrapped into a ragged 2×2 of
   * differing heights — which is the whole complaint the menu was restyled for.
   * 268 is the measure that holds "Load demo profile" and a two-line status on
   * one column without the status re-flowing the buttons.
   */
  menuWidth: 268,
  menuControlHeight: 38,
  /** Max measure of the chat column's text content. */
  chatColumnMaxWidth: 620,
} as const;

export const animation = {
  durations: {
    fast: 200,
    normal: 300,
    slow: 400,
  },
  easing: {
    easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
    easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
    easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
} as const;

export const borderRadius = {
  sm: '6px',
  md: '10px',
  lg: '16px',
  xl: '20px',
  xxl: '24px',
  full: '9999px',
} as const;

export const shadows = {
  card: '0 1px 3px rgba(45, 32, 36, 0.06), 0 4px 12px rgba(45, 32, 36, 0.04)',
  cardHover: '0 2px 8px rgba(45, 32, 36, 0.08), 0 8px 24px rgba(45, 32, 36, 0.06)',
  subtle: '0 1px 2px rgba(45, 32, 36, 0.04)',
  bubble: '0 1px 4px rgba(45, 32, 36, 0.06)',
  input: '0 2px 8px rgba(45, 32, 36, 0.04)',
  header: '0 1px 0 rgba(45, 32, 36, 0.06)',
} as const;

export const breakpoints = {
  mobile: 768,
} as const;
