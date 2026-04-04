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
} as const;

export const typography = {
  headingFontFamily: "'Playfair Display', 'Georgia', serif",
  bodyFontFamily: "'Inter', 'Helvetica Neue', sans-serif",
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
