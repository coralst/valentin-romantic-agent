/**
 * Design tokens for Valentin — warm, sophisticated, romantic palette.
 * All spacing values follow an 8px grid. Animation durations stay within 200–400ms.
 */

export const colors = {
  // Core palette
  dustyRose: '#C4A0A5',
  champagne: '#F5E6CC',
  softBurgundy: '#8B3A4A',
  warmIvory: '#FAF6F0',
  warmTaupe: '#B8A99A',
  deepPlum: '#5C2434',
  blush: '#E8C4C8',
  cream: '#FFF8F0',

  // Semantic tokens
  agentBubble: '#F5E6CC',
  userBubble: '#C4A0A5',
  background: '#FAF6F0',
  surface: '#FFFFFF',
  text: '#3D2B2B',
  textSecondary: '#7A6565',
  border: '#E0D5CC',
  highlight: '#E8C4C8',
  error: '#C0392B',
  success: '#5C8A5C',
} as const;

export const typography = {
  headingFontFamily: "'Playfair Display', 'Georgia', serif",
  bodyFontFamily: "'Inter', 'Helvetica Neue', sans-serif",
  sizes: {
    xs: '0.75rem',
    sm: '0.875rem',
    base: '1rem',
    md: '1.125rem',
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
  sm: '4px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  full: '9999px',
} as const;

export const shadows = {
  card: '0 2px 8px rgba(61, 43, 43, 0.08)',
  cardHover: '0 4px 16px rgba(61, 43, 43, 0.12)',
  subtle: '0 1px 3px rgba(61, 43, 43, 0.06)',
} as const;

export const breakpoints = {
  mobile: 768,
} as const;
