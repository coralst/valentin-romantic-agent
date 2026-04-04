import { colors, typography } from './tokens';

/**
 * CSS reset and base styles using design tokens.
 * Inject this as a <style> tag or use with a CSS-in-JS solution.
 */
export const globalStyles = `
  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  html {
    font-size: 16px;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  body {
    font-family: ${typography.bodyFontFamily};
    font-size: ${typography.sizes.base};
    line-height: ${typography.lineHeights.normal};
    color: ${colors.text};
    background-color: ${colors.background};
  }

  h1, h2, h3, h4, h5, h6 {
    font-family: ${typography.headingFontFamily};
    font-weight: ${typography.weights.bold};
    line-height: ${typography.lineHeights.tight};
    color: ${colors.text};
  }

  h1 { font-size: ${typography.sizes.xxl}; }
  h2 { font-size: ${typography.sizes.xl}; }
  h3 { font-size: ${typography.sizes.lg}; }
  h4 { font-size: ${typography.sizes.md}; }

  a {
    color: ${colors.softBurgundy};
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }

  button {
    font-family: ${typography.bodyFontFamily};
    cursor: pointer;
    border: none;
    background: none;
  }

  input, textarea {
    font-family: ${typography.bodyFontFamily};
    font-size: ${typography.sizes.base};
  }
`;
