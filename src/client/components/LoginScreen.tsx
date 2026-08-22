import React, { useEffect, useState } from 'react';
import { useAuthContext } from '../context/auth-context';
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
 * Two ways in and nothing else: **Login**, which opens the ready-made profile,
 * and **Create an Account**, which opens an empty one so Valentin asks about
 * your partner from scratch. The previous version put a persona picker in front
 * of a single CTA, which asked the visitor to understand the demo's internals
 * before it would let them in.
 *
 * **On the prefilled credentials.** The email and password sit in the form
 * already filled, so Login is one click on stage. The password shown here is
 * filler — the real demo credential lives in Secrets Manager and never reaches
 * this bundle, and clicking Login calls the server-side demo-login endpoint
 * which reads it there. So the field is honest about being a form and dishonest
 * about being the secret, which is the only combination that is both
 * demonstrable and safe.
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
 */

/**
 * The demo visitor's address, shown in the form.
 *
 * Cosmetic: the Cognito account this actually authenticates as is
 * `demo@valentin.local`, held with its password in Secrets Manager. This is the
 * name the audience reads.
 */
const PREFILLED_EMAIL = 'Ralf1988@gmail.com';

/**
 * Filler for the password field, not a credential.
 *
 * Twelve characters so the dots look like a real password rather than a hint.
 * Never the actual secret: this string is compiled into a public JS bundle.
 */
const PREFILLED_PASSWORD = 'valentin1988';

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
  maxWidth: 460,
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

/** The form sits on porcelain so the linen page reads as space around it. */
const cardStyle: React.CSSProperties = {
  padding: insets.roomy,
  borderRadius: radii.card,
  backgroundColor: colors.porcelain,
  boxShadow: `0 0 0 1px ${colors.linenShade}, 0 18px 44px rgba(42,34,38,0.08)`,
  textAlign: 'left',
};

const fieldStyle: React.CSSProperties = {
  marginBottom: insets.tight,
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 6,
  fontSize: typography.px.eyebrow,
  fontWeight: typography.weights.semibold,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: colors.gold,
};

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: `12px ${insets.snug}px`,
  boxSizing: 'border-box',
  borderRadius: radii.kv,
  border: 'none',
  backgroundColor: colors.linen,
  boxShadow: `inset 0 0 0 1px ${colors.linenShade}`,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.body,
  color: colors.ink,
};

const ctaStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: `15px ${insets.roomy}px`,
  marginTop: insets.snug,
  borderRadius: radii.pill,
  backgroundColor: colors.claret,
  color: colors.onClaret,
  fontSize: typography.px.control,
  fontWeight: typography.weights.semibold,
  letterSpacing: '0.01em',
  boxShadow: '0 12px 28px rgba(140,47,69,0.26)',
  cursor: 'pointer',
};

const disabledCtaStyle: React.CSSProperties = {
  ...ctaStyle,
  opacity: 0.6,
  cursor: 'default',
};

/**
 * The second door, weighted below the first but not hidden.
 *
 * A visitor creating an account is doing the more consequential thing, so it
 * gets a real button rather than the text link the previous version used — but
 * claret stays with Login, because on stage that is the one being clicked.
 */
const secondaryStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: `14px ${insets.roomy}px`,
  borderRadius: radii.pill,
  backgroundColor: 'transparent',
  color: colors.claret,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.control,
  fontWeight: typography.weights.semibold,
  boxShadow: `inset 0 0 0 1.5px rgba(140,47,69,0.28)`,
  cursor: 'pointer',
};

const disabledSecondaryStyle: React.CSSProperties = {
  ...secondaryStyle,
  opacity: 0.6,
  cursor: 'default',
};

/** A hairline with a word in it, separating the two doors. */
const dividerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: insets.tight,
  margin: `${insets.snug}px 0`,
  fontSize: typography.px.eyebrow,
  fontWeight: typography.weights.semibold,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: colors.inkFaint,
};

const dividerRuleStyle: React.CSSProperties = {
  flex: 1,
  height: 1,
  background: colors.hairlineGradient,
  border: 'none',
};

const hintStyle: React.CSSProperties = {
  marginTop: insets.tight,
  fontSize: typography.px.caption,
  color: colors.inkFaint,
  textAlign: 'center',
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

/**
 * The persona each door opens.
 *
 * Ids rather than names, because these are the server's own persona ids from
 * `demo-personas.ts`. Login lands in the filled profile; Create an Account lands
 * in an empty one, which is what makes it a welcome conversation.
 */
const LOGIN_PERSONA = 'samantha';
const SIGNUP_PERSONA = 'fresh';

export function LoginScreen() {
  const {
    status,
    error,
    busy,
    demoAvailable,
    hostedAvailable,
    authDisabled,
    signIn,
    signUp,
    signInAsDemo,
  } = useAuthContext();

  const isNarrow = useIsNarrow();

  // Editable, though nobody will: a read-only field that looks like an input is
  // worse than one that works, and a presenter who wants to type a different
  // address should be able to.
  const [email, setEmail] = useState(PREFILLED_EMAIL);
  const [password, setPassword] = useState(PREFILLED_PASSWORD);

  /**
   * Login, by whichever route this deployment actually has.
   *
   * Production has the demo endpoint, so Login opens the seeded profile. A local
   * run with `authDisabled` has no Cognito at all and `signIn` restores the
   * development user instead — same button, same place, so the rehearsal driver
   * and the presenter both find one Login control either way.
   */
  const handleLogin = () => {
    if (demoAvailable) {
      signInAsDemo(LOGIN_PERSONA);
      return;
    }
    signIn();
  };

  /**
   * Create an Account.
   *
   * On a deployment with the demo endpoint this opens a *separate*, empty
   * profile rather than running Cognito's hosted sign-up: hosted sign-up would
   * bounce the visitor to an email-verification round trip, which is not a demo.
   * The empty profile is the honest version of what a new account looks like —
   * Valentin knows nothing and opens by asking. Falls back to real hosted
   * sign-up where that is the only thing available.
   */
  const handleSignUp = () => {
    if (demoAvailable) {
      signInAsDemo(SIGNUP_PERSONA);
      return;
    }
    signUp();
  };

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

  const canEnter = demoAvailable || hostedAvailable || authDisabled;

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

        {canEnter && (
          <div style={cardStyle}>
            <div style={fieldStyle}>
              <label style={labelStyle} htmlFor="login-email">
                Email
              </label>
              <input
                id="login-email"
                type="email"
                autoComplete="username"
                style={inputStyle}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={busy}
                data-testid="login-email"
              />
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle} htmlFor="login-password">
                Password
              </label>
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                style={inputStyle}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy}
                data-testid="login-password"
              />
            </div>

            <button
              type="button"
              style={busy ? disabledCtaStyle : ctaStyle}
              onClick={handleLogin}
              disabled={busy}
              data-testid="demo-login-button"
            >
              {busy ? 'Opening…' : 'Login'}
            </button>

            <div style={dividerStyle}>
              <hr style={dividerRuleStyle} />
              <span>or</span>
              <hr style={dividerRuleStyle} />
            </div>

            <button
              type="button"
              style={busy ? disabledSecondaryStyle : secondaryStyle}
              onClick={handleSignUp}
              disabled={busy}
              data-testid="sign-up-button"
            >
              Create an Account
            </button>

            <p style={hintStyle}>
              A new account starts empty — Valentin opens by asking about your
              partner.
            </p>
          </div>
        )}

        {error && (
          <p style={errorStyle} role="alert" data-testid="login-error">
            {error}
          </p>
        )}

        {!canEnter && (
          <p style={errorStyle} role="alert">
            No sign-in method is configured on this deployment yet.
          </p>
        )}
      </div>
    </div>
  );
}
