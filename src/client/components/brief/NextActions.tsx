import { colors, radii, typography } from '../../design-system/tokens';
import { openTasks, type Task } from '../../../shared/interfaces/task';
import { DossierIcon, type DossierIconName } from '../dossier/dossier-icons';
import { SectionHead } from './SectionHead';
import { onClaret, ROW_HAIRLINE } from './rail-tones';

/**
 * What to do next — three rows, each carrying the button that does it.
 *
 * This replaced "Don't forget", and the change is the button. A rail that only
 * warns you makes you go and find the thing to click; these rows *are* the
 * control. The first is styled as the primary one because a list of three equal
 * calls to action is a list of none.
 *
 * The same tasks the board's own list holds, so ticking one there empties a row
 * here — one source, two surfaces. Three, because the fourth is the first row
 * nobody reads in a 306px column that also has to carry her portrait, a countdown
 * and the pinned annuals above the fold.
 */

const stackStyle: React.CSSProperties = {
  borderRadius: 15,
  overflow: 'hidden',
  background: onClaret(0.1),
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '11px 13px',
};

const dividedRowStyle: React.CSSProperties = {
  ...rowStyle,
  borderTop: ROW_HAIRLINE,
};

/** The first row: a shade brighter, so one of the three reads as the one to do. */
const firstRowStyle: React.CSSProperties = {
  ...rowStyle,
  background: onClaret(0.1),
};

const bodyStyle: React.CSSProperties = { flex: 1, minWidth: 0 };

const titleStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.body,
  fontWeight: typography.weights.semibold,
  lineHeight: 1.3,
  color: '#FBEFF1',
};

const noteStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.label,
  lineHeight: 1.35,
  color: onClaret(0.62),
};

const buttonStyle: React.CSSProperties = {
  flex: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '7px 13px',
  borderRadius: radii.pill,
  background: 'transparent',
  color: '#FBEFF1',
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.label,
  fontWeight: typography.weights.semibold,
  boxShadow: `inset 0 0 0 1.5px ${onClaret(0.3)}`,
  whiteSpace: 'nowrap',
};

const firstButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: colors.cream,
  color: '#6B1F32',
  boxShadow: 'none',
};

/**
 * What the row's button says, and what its mark is.
 *
 * Read off the task's own wording rather than stored, because the verb is not a
 * property of a to-do — "ask her which weekend" and "book the table" are the same
 * kind of row with different first words, and asking the extractor to classify
 * them would be one more thing for it to get wrong. Three verbs, in the order they
 * are checked; anything else is an ordinary row with no button.
 */
const VERBS: ReadonlyArray<{ match: RegExp; action: string; icon: DossierIconName }> = [
  { match: /^ask\b|\bask her\b/i, action: 'Ask', icon: 'ask' },
  { match: /^book\b|\breserve\b|\bplan\b/i, action: 'Plan', icon: 'calendar' },
  { match: /\bcard\b|\bwrite\b|\bmessage\b/i, action: 'Draft', icon: 'cake' },
];

/** The default: every to-do can at least be raised in conversation. */
const FALLBACK = { action: 'Ask', icon: 'check' as DossierIconName };

export function actionFor(title: string): { action: string; icon: DossierIconName } {
  const verb = VERBS.find((candidate) => candidate.match.test(title));
  return verb ? { action: verb.action, icon: verb.icon } : FALLBACK;
}

interface NextActionsProps {
  tasks: Task[];
  /** Drops the row into the composer as a line Valentin can act on. */
  onAct: (task: Task) => void;
  limit?: number;
}

export function NextActions({ tasks, onAct, limit = 3 }: NextActionsProps) {
  const open = openTasks(tasks).slice(0, limit);
  if (open.length === 0) return null;

  return (
    <>
      <SectionHead label="What to do next" count={open.length} />
      <div style={stackStyle} data-testid="brief-next-actions">
        {open.map((task, index) => {
          const { action, icon } = actionFor(task.title);
          return (
            <div
              key={task.id}
              style={index === 0 ? firstRowStyle : dividedRowStyle}
              data-testid={`brief-action-${task.id}`}
            >
              <span style={{ color: '#F2D4D8', display: 'flex' }} aria-hidden="true">
                <DossierIcon name={icon} size={16} />
              </span>
              <span style={bodyStyle}>
                <span style={titleStyle}>{task.title}</span>
                {task.note && <span style={noteStyle}>{task.note}</span>}
              </span>
              <button
                type="button"
                style={index === 0 ? firstButtonStyle : buttonStyle}
                onClick={() => onAct(task)}
                aria-label={`${action}: ${task.title}`}
              >
                {action}
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
