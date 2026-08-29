import { useId, useState } from 'react';
import { colors, insets, radii, typography } from '../design-system/tokens';
import { CONNECT_RECIPES, type ConnectableId } from '../utils/integration-connect';
import type { ConnectStatus } from '../hooks/use-integration-connect';

/**
 * The form that gives this deployment a provider's credentials.
 *
 * It sits inside the consent sheet rather than in a dialog of its own, and that
 * placement is the point: the visitor clicked a capability because they wanted it
 * to work, and "it cannot work yet, here is why, here is the fix" belongs in the
 * same breath as "here is what it would be allowed to do". A second dialog would
 * make the missing credential feel like a different subject.
 *
 * It stays visually distinct — its own heading and rule — because the two blocks
 * are genuinely different claims. The scope list above is what the *visitor*
 * grants Valentin. This is what the *server* holds. The panel has been careful
 * about that distinction from the start and this is the place it is easiest to
 * blur.
 *
 * Values live in this component's state and nowhere else. They go straight into
 * the request and are dropped on unmount; nothing is put in localStorage, and
 * secrets render as `type="password"` because this UI gets projected.
 */

interface IntegrationCredentialsFormProps {
  id: ConnectableId;
  status: ConnectStatus;
  onSubmit: (fields: Record<string, string>) => void;
  /** Present when the service is already connected, which offers "Forget these". */
  onDisconnect?: () => void;
  /**
   * True when the server already holds working credentials for this provider.
   *
   * Collapses the block to a line and a Forget button, with the inputs behind a
   * "Replace" toggle. Showing empty inputs for a working service is an invitation
   * to overwrite a good credential with a typo — and since the server probes
   * before it applies, the typo is rejected and the *old* value survives, so the
   * visitor sees an error for a service that is actually fine. Quieter to not ask.
   */
  alreadyConnected?: boolean;
}

const blockStyle: React.CSSProperties = {
  marginTop: insets.tight,
  paddingTop: insets.tight,
  borderTop: `1px solid ${colors.linenShade}`,
};

const headingStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.label,
  fontWeight: typography.weights.semibold,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: colors.inkFaint,
  margin: `0 0 6px`,
};

const whereStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.label,
  color: colors.inkMuted,
  lineHeight: typography.lineHeights.normal,
  margin: `0 0 ${insets.tight}px`,
};

const linkStyle: React.CSSProperties = {
  color: colors.claret,
  textDecoration: 'underline',
};

const fieldStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 8,
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.label,
  color: colors.ink,
  marginBottom: 3,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  height: 34,
  padding: '0 10px',
  borderRadius: radii.chip,
  border: `1px solid ${colors.linenShade}`,
  backgroundColor: colors.porcelain,
  color: colors.ink,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.small,
};

function buttonStyle(disabled: boolean): React.CSSProperties {
  return {
    height: 34,
    padding: '0 14px',
    border: 'none',
    borderRadius: radii.chip,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    backgroundColor: colors.claret,
    color: colors.onClaret,
    fontFamily: typography.bodyFontFamily,
    fontSize: typography.px.label,
    fontWeight: typography.weights.semibold,
  };
}

const ghostButtonStyle: React.CSSProperties = {
  height: 34,
  padding: '0 12px',
  borderRadius: radii.chip,
  border: `1px solid ${colors.linenShade}`,
  backgroundColor: colors.porcelain,
  color: colors.inkMuted,
  cursor: 'pointer',
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.label,
};

const cautionStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.label,
  color: colors.inkFaint,
  lineHeight: typography.lineHeights.normal,
  margin: `${insets.tight}px 0 0`,
};

function messageStyle(kind: 'error' | 'done'): React.CSSProperties {
  return {
    fontFamily: typography.bodyFontFamily,
    fontSize: typography.px.label,
    lineHeight: typography.lineHeights.normal,
    color: kind === 'error' ? colors.claret : colors.olive,
    backgroundColor: kind === 'error' ? colors.petal : colors.sand,
    border: `1px solid ${colors.linenShade}`,
    borderRadius: radii.chip,
    padding: `6px ${insets.tight}px`,
    margin: `${insets.tight}px 0 0`,
  };
}

export function IntegrationCredentialsForm({
  id,
  status,
  onSubmit,
  onDisconnect,
  alreadyConnected = false,
}: IntegrationCredentialsFormProps) {
  const recipe = CONNECT_RECIPES[id];
  const [values, setValues] = useState<Record<string, string>>({});
  const [replacing, setReplacing] = useState(false);
  const formId = useId();
  const showInputs = !alreadyConnected || replacing;

  // Only this provider's own status is ours to render. The hook is shared across
  // every capability in the panel, so without this check a failed WhatsApp
  // attempt would print its error under the Amadeus form too.
  const mine = status.phase !== 'idle' && status.id === id ? status : null;
  const busy = mine?.phase === 'working' || mine?.phase === 'consenting';
  const complete = recipe.fields.every((field) => (values[field.name] ?? '').trim() !== '');

  const label = busy
    ? mine?.phase === 'consenting'
      ? 'Waiting for Google…'
      : 'Checking…'
    : recipe.needsConsent
      ? `Save & sign in with ${recipe.provider}`
      : `Connect ${recipe.provider}`;

  return (
    <div style={blockStyle} data-testid={`integration-credentials-${id}`}>
      <p style={headingStyle}>{recipe.provider} credentials · this server</p>

      {alreadyConnected ? (
        <p style={whereStyle} data-testid={`integration-held-${id}`}>
          This server holds working {recipe.provider} credentials. They are never shown
          back — not even partly — so replacing them means pasting new ones.
        </p>
      ) : (
        <p style={whereStyle}>
          {recipe.where}{' '}
          <a href={recipe.href} target="_blank" rel="noreferrer noopener" style={linkStyle}>
            Open {recipe.provider}
          </a>
        </p>
      )}

      {/* A real form, so Enter submits and password managers behave. The panel
          lives inside no other form, so nesting is not a concern. */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!complete || busy) return;
          onSubmit(values);
        }}
      >
        {showInputs &&
          recipe.fields.map((field) => (
            <label key={field.name} style={fieldStyle} htmlFor={`${formId}-${field.name}`}>
              <span style={labelStyle}>{field.label}</span>
              <input
                id={`${formId}-${field.name}`}
                // `password` for anything secret: this panel is shown on a
                // projector, and a secret rendered in plain text is disclosed
                // whether or not anyone intended it.
                type={field.secret ? 'password' : 'text'}
                value={values[field.name] ?? ''}
                placeholder={field.placeholder}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) =>
                  setValues((prev) => ({ ...prev, [field.name]: event.target.value }))
                }
                style={inputStyle}
                data-testid={`integration-field-${id}-${field.name}`}
              />
            </label>
          ))}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
          {showInputs && (
            <button
              type="submit"
              disabled={!complete || busy}
              style={buttonStyle(!complete || busy)}
              data-testid={`integration-connect-submit-${id}`}
            >
              {label}
            </button>
          )}
          {alreadyConnected && !replacing && (
            <button
              type="button"
              onClick={() => setReplacing(true)}
              style={ghostButtonStyle}
              data-testid={`integration-replace-${id}`}
            >
              Replace
            </button>
          )}
          {onDisconnect && (
            <button
              type="button"
              onClick={onDisconnect}
              style={ghostButtonStyle}
              data-testid={`integration-forget-${id}`}
            >
              Forget these
            </button>
          )}
        </div>
      </form>

      {mine?.phase === 'error' && (
        <p style={messageStyle('error')} role="alert" data-testid={`integration-error-${id}`}>
          {mine.message}
        </p>
      )}
      {mine?.phase === 'done' && (
        <p style={messageStyle('done')} role="status" data-testid={`integration-done-${id}`}>
          {mine.message}
        </p>
      )}

      {recipe.caution && <p style={cautionStyle}>{recipe.caution}</p>}
    </div>
  );
}
