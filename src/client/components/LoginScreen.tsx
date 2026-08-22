import React, { useEffect, useState } from 'react';
import { useAuthContext } from '../context/auth-context';
import type { DemoPersonaSummary } from '../auth/runtime-config';
import {
  breakpoints,
  colors,
  insets,
  radii,
  spacing,
  typography,
} from '../design-system/tokens';

/**
 * The front door.
 *
 * Rebuilt on the vitrine palette. The previous version was a 420px white card on
 * the legacy rose tokens (`softBurgundy`, `accentGradient`, `borderRadius.xxl`) —
 * it predated the window shell and read as a different product than the app it
 * opened.
 *
 * **On decoration.** Both locked mockups contain zero decorative SVG. The whole
 * vocabulary is the circular crest, Unicode glyphs, gradient hairlines,
 * box-shadow rings, large radii and soft double shadows — and the one floral
 * motif in the repo is a rose *inside* `partner-portrait.svg`, whose own comment
 * says it answers the rose in the crest. So the warmth here comes from a large
 * crest with a gold ring, a glyph frieze, and generous claret/cream space. No new
 * assets, no clip-art: the point of this screen is that it does not look like a
 * generic AI app, and imported botanical stock would undo that faster than a
 * plain page ever could.
 *
 * Two ways in, and the demo comes first: the common visitor wants to see what
 * this is, not to open an account.
 */

const pageStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '100vh',
  padding: spacing.md,
  backgroundColor: colors.linen,
  // Two washes, not one: petal from above puts the light behind the crest, and
  // the sand pool underneath keeps the foot of the page from going flat grey.
  backgroundImage: `radial-gradient(120% 78% at 50% -14%, ${colors.petal} 0%, rgba(246,222,226,0) 62%), radial-gradient(90% 60% at 50% 118%, ${colors.sand} 0%, rgba(250,244,240,0) 70%)`,
  fontFamily: typography.bodyFontFamily,
  color: colors.ink,
};

const columnStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 640,
  textAlign: 'center',
};

/** The crest: a ring rather than a border, so the gold reads as light on glass. */
function getCrestStyle(isNarrow: boolean): React.CSSProperties {
  const size = isNarrow ? 96 : 132;
  return {
    width: size,
    height: size,
    margin: '0 auto',
    borderRadius: radii.pill,
    overflow: 'hidden',
    backgroundColor: colors.porcelain,
    display: 'grid',
    placeItems: 'center',
    boxShadow: `0 0 0 1px rgba(176,140,79,0.42), 0 0 0 9px rgba(255,253,251,0.55), 0 18px 40px rgba(42,34,38,0.16)`,
  };
}

/**
 * The crest overflows its circle by 20%.
 *
 * `logo.png` is square with its own margin baked in; contained at 132px it sits
 * in the middle of a visibly empty disc. Covering at 120% crops that margin back
 * off, which is what `IconRail` does with the same asset at 46px.
 */
const crestImageStyle: React.CSSProperties = {
  width: '120%',
  height: '120%',
  objectFit: 'cover',
};

function getWordmarkStyle(isNarrow: boolean): React.CSSProperties {
  return {
    margin: `${insets.snug}px 0 0`,
    fontFamily: typography.headingFontFamily,
    // Gloock ships one weight — see the note in `global-styles.ts`. Size carries
    // the hierarchy here, which is the entire reason `px.hero` exists.
    fontWeight: typography.weights.normal,
    fontSize: isNarrow ? typography.px.display + 8 : typography.px.hero,
    lineHeight: 1.05,
    letterSpacing: '-0.015em',
    color: colors.claret,
  };
}

const eyebrowStyle: React.CSSProperties = {
  display: 'block',
  marginTop: 6,
  fontSize: typography.px.eyebrowWide,
  fontWeight: typography.weights.semibold,
  letterSpacing: '0.26em',
  textTransform: 'uppercase',
  color: colors.gold,
};

const ruleStyle: React.CSSProperties = {
  height: 1,
  margin: `${insets.snug}px auto`,
  maxWidth: 320,
  background: colors.hairlineGradient,
  border: 'none',
};

const taglineStyle: React.CSSProperties = {
  margin: `0 auto ${insets.snug}px`,
  maxWidth: 420,
  fontSize: typography.px.bodyLarge,
  lineHeight: typography.lineHeights.relaxed,
  color: colors.inkMuted,
};

/**
 * The flowers, in the language the mockups actually speak.
 *
 * `aria-hidden` because a screen reader announcing "white florette, middle dot,
 * black florette" is noise, not decoration.
 */
const friezeStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: insets.roomy,
  fontSize: typography.px.small,
  letterSpacing: '0.7em',
  color: colors.gold,
  opacity: 0.5,
};

function getPersonaGridStyle(isNarrow: boolean): React.CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: isNarrow ? '1fr' : '1fr 1fr',
    gap: insets.tight,
    marginBottom: insets.roomy,
    textAlign: 'left',
  };
}

/**
 * A persona card is a radio in everything but markup — one of the pair is always
 * chosen, and choosing does not submit. Selection shows as a claret ring and a
 * lifted surface rather than a checkmark, because the pair is only two wide and a
 * tick would be the loudest thing on the page.
 */
function getPersonaCardStyle(isSelected: boolean): React.CSSProperties {
  return {
    display: 'block',
    width: '100%',
    padding: `${insets.snug}px ${insets.snug}px`,
    textAlign: 'left',
    borderRadius: radii.card,
    backgroundColor: isSelected ? colors.porcelain : 'rgba(255,253,251,0.62)',
    boxShadow: isSelected
      ? `0 0 0 1.5px ${colors.claret}, 0 10px 26px rgba(140,47,69,0.14)`
      : `0 0 0 1px ${colors.linenShade}, 0 4px 14px rgba(42,34,38,0.05)`,
    cursor: 'pointer',
    transition: 'box-shadow 200ms ease, background-color 200ms ease',
  };
}

const personaGlyphStyle: React.CSSProperties = {
  fontSize: typography.px.body,
  color: colors.claret,
  marginRight: 8,
};

const personaNameStyle: React.CSSProperties = {
  fontFamily: typography.headingFontFamily,
  fontWeight: typography.weights.normal,
  fontSize: typography.px.headingSm,
  color: colors.ink,
};

const personaBlurbStyle: React.CSSProperties = {
  margin: '6px 0 0',
  fontSize: typography.px.smallLoose,
  lineHeight: typography.lineHeights.normal,
  color: colors.inkMuted,
};

const personaCountStyle: React.CSSProperties = {
  display: 'block',
  marginTop: 10,
  fontSize: typography.px.eyebrow,
  fontWeight: typography.weights.semibold,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: colors.gold,
};

const ctaStyle: React.CSSProperties = {
  display: 'inline-block',
  minWidth: 260,
  padding: `15px ${insets.roomy}px`,
  borderRadius: radii.pill,
  backgroundColor: colors.claret,
  color: colors.onClaret,
  fontSize: typography.px.control,
  fontWeight: typography.weights.semibold,
  letterSpacing: '0.01em',
  boxShadow: '0 12px 28px rgba(140,47,69,0.26)',
};

const disabledCtaStyle: React.CSSProperties = {
  ...ctaStyle,
  opacity: 0.6,
  cursor: 'default',
};

const quietRowStyle: React.CSSProperties = {
  marginTop: insets.roomy,
  display: 'flex',
  gap: insets.tight,
  alignItems: 'center',
  justifyContent: 'center',
  flexWrap: 'wrap',
};

const quietLinkStyle: React.CSSProperties = {
  padding: 0,
  background: 'none',
  fontSize: typography.px.smallLoose,
  color: colors.inkMuted,
  textDecoration: 'underline',
  textDecorationColor: colors.linenShade,
  textUnderlineOffset: 3,
};

const quietDotStyle: React.CSSProperties = {
  fontSize: typography.px.small,
  color: colors.inkFaint,
};

const hintStyle: React.CSSProperties = {
  marginTop: insets.tight,
  fontSize: typography.px.caption,
  color: colors.inkFaint,
};

const errorStyle: React.CSSProperties = {
  marginTop: insets.tight,
  fontSize: typography.px.body,
  color: colors.error,
};

const spinnerStyle: React.CSSProperties = {
  fontSize: typography.px.bodyLarge,
  color: colors.inkMuted,
  fontFamily: typography.bodyFontFamily,
};

/**
 * The breakpoint, read the same way `AppLayout` reads it.
 *
 * Guarded for jsdom, where `matchMedia` is not implemented — without the guard
 * every test that renders this screen throws before asserting anything.
 */
function useIsNarrow(): boolean {
  const [isNarrow, setIsNarrow] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(`(max-width: ${breakpoints.mobile - 1}px)`);
    setIsNarrow(mql.matches);

    const handler = (event: MediaQueryListEvent) => setIsNarrow(event.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isNarrow;
}

/** `♥` for a profile that is already full, `◆` for one still to be filled. */
function personaGlyph(persona: DemoPersonaSummary): string {
  return persona.fieldCount > 0 ? '♥' : '◆';
}

function personaCount(persona: DemoPersonaSummary): string {
  return persona.fieldCount > 0
    ? `${persona.fieldCount} of ${persona.fieldCount} known`
    : "0 of 18 · he'll ask";
}

export function LoginScreen() {
  const {
    status,
    error,
    busy,
    demoAvailable,
    demoPersonas,
    hostedAvailable,
    authDisabled,
    signIn,
    signUp,
    signInAsDemo,
  } = useAuthContext();

  const isNarrow = useIsNarrow();

  /**
   * Which persona the CTA will open.
   *
   * `null` until the config arrives, then the first advertised persona. Not
   * defaulted to the string `'samantha'`: the server owns that default and says
   * so in its response, and hard-coding a second copy here is how the two drift.
   */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    demoPersonas.find((persona) => persona.id === selectedId) ?? demoPersonas[0];

  const crest = (
    <div style={getCrestStyle(isNarrow)}>
      <img src="/logo.png" alt="" style={crestImageStyle} />
    </div>
  );

  const masthead = (
    <>
      {crest}
      <h1 style={getWordmarkStyle(isNarrow)}>Valentin</h1>
      <span style={eyebrowStyle}>Romantic Agent</span>
    </>
  );

  if (status === 'loading') {
    return (
      <div style={pageStyle} data-testid="auth-loading">
        <p style={spinnerStyle}>Just a moment…</p>
      </div>
    );
  }

  if (status === 'error') {
    // The server is unreachable, so no button here could do anything. Offering
    // one would just invite a second failure.
    return (
      <div style={pageStyle} data-testid="auth-error">
        <div style={columnStyle}>
          {masthead}
          <hr style={ruleStyle} />
          <p style={errorStyle} role="alert">
            {error ?? 'Something went wrong. Refresh to try again.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle} data-testid="login-screen">
      <div style={columnStyle}>
        {masthead}
        <hr style={ruleStyle} />
        <p style={taglineStyle}>
          He remembers what matters to the person you love — and tells you, at the
          moment it helps.
        </p>
        <span style={friezeStyle} aria-hidden="true">
          ✿·❀·✿
        </span>

        {demoAvailable && demoPersonas.length > 0 && (
          <>
            <div
              style={getPersonaGridStyle(isNarrow)}
              role="radiogroup"
              aria-label="Choose a demo profile"
              data-testid="persona-picker"
            >
              {demoPersonas.map((persona) => {
                const isSelected = persona.id === selected?.id;
                return (
                  <button
                    key={persona.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    style={getPersonaCardStyle(isSelected)}
                    onClick={() => setSelectedId(persona.id)}
                    disabled={busy}
                    data-testid={`persona-${persona.id}`}
                  >
                    <span>
                      <span style={personaGlyphStyle} aria-hidden="true">
                        {personaGlyph(persona)}
                      </span>
                      <span style={personaNameStyle}>{persona.name}</span>
                    </span>
                    <p style={personaBlurbStyle}>{persona.blurb}</p>
                    <span style={personaCountStyle}>{personaCount(persona)}</span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              style={busy ? disabledCtaStyle : ctaStyle}
              // The persona id travels with the click. `signInAsDemo` takes it as
              // an optional argument, so a bare handler would hand it a MouseEvent.
              onClick={() => signInAsDemo(selected?.id)}
              disabled={busy}
              data-testid="demo-login-button"
            >
              {busy ? 'Opening…' : `Meet ${selected?.name ?? 'the demo'}  →`}
            </button>
          </>
        )}

        {/* A deployment that predates personas advertises none. It still has a
            working demo login, so it keeps a plain button rather than losing the
            only way in. */}
        {demoAvailable && demoPersonas.length === 0 && (
          <button
            type="button"
            style={busy ? disabledCtaStyle : ctaStyle}
            onClick={() => signInAsDemo()}
            disabled={busy}
            data-testid="demo-login-button"
          >
            {busy ? 'Opening the demo…' : 'Try the demo  →'}
          </button>
        )}

        <div style={quietRowStyle}>
          {(hostedAvailable || authDisabled) && (
            <button
              type="button"
              style={quietLinkStyle}
              onClick={signIn}
              disabled={busy}
              data-testid="sign-in-button"
            >
              {authDisabled ? 'Continue' : 'Sign in with email'}
            </button>
          )}

          {/* Register is real Cognito sign-up, deliberately quiet: nobody should
              reach for it by accident while the app is on a projector.
              `authDisabled` means there are no accounts to create. */}
          {hostedAvailable && !authDisabled && (
            <>
              <span style={quietDotStyle} aria-hidden="true">
                ·
              </span>
              <button
                type="button"
                style={quietLinkStyle}
                onClick={signUp}
                disabled={busy}
                data-testid="sign-up-button"
              >
                Create an account
              </button>
            </>
          )}
        </div>

        {error && (
          <p style={errorStyle} role="alert" data-testid="login-error">
            {error}
          </p>
        )}

        {!demoAvailable && !hostedAvailable && !authDisabled && (
          <p style={errorStyle} role="alert">
            No sign-in method is configured on this deployment yet.
          </p>
        )}

        {demoAvailable && (
          <p style={hintStyle}>
            The demo profile is shared and clears itself out after half an hour.
          </p>
        )}
      </div>
    </div>
  );
}
