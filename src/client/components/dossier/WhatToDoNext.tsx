import { colors, radii, typography } from '../../design-system/tokens';
import { doneTasks, openTasks, type Task } from '../../../shared/interfaces/task';
import {
  cardCountStyle,
  cardHeadStyle,
  cardStyle,
  cardTitleStyle,
  goldWash,
  GOLD_INK,
  linenWash,
} from './board-tones';
import { DossierIcon, dossierType } from './dossier-icons';

/**
 * What he has to do, with a tick that survives the reload.
 *
 * The board's top-right half, and the one card here that is about him rather than
 * about her. It replaced "Don't forget", which only warned: every row now carries
 * its own state, so the card is a place to *finish* something instead of a place
 * to be reminded that you have not.
 *
 * Open rows first, soonest deadline first, undated last; ticked rows underneath,
 * most recently finished first. Ticked rows stay on screen rather than
 * disappearing — a list that swallows completed work gives you nothing back for
 * doing it, and the two ticked rows are what make the tick look reliable.
 */

const wrapperStyle: React.CSSProperties = {
  ...cardStyle,
  display: 'flex',
  flexDirection: 'column',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 12,
  padding: '11px 0',
  width: '100%',
  background: 'none',
  border: 'none',
  textAlign: 'left',
  cursor: 'pointer',
  font: 'inherit',
  color: colors.ink,
};

const dividedRowStyle: React.CSSProperties = {
  ...rowStyle,
  borderTop: `1.5px solid ${linenWash(0.55)}`,
};

/** The box. Empty is a ring; ticked is filled claret with a cream check. */
const boxStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: 8,
  flex: 'none',
  marginTop: 1,
  boxShadow: `inset 0 0 0 2px ${colors.linenShade}`,
  display: 'grid',
  placeItems: 'center',
  color: 'transparent',
};

const doneBoxStyle: React.CSSProperties = {
  ...boxStyle,
  background: colors.claret,
  boxShadow: 'none',
  color: colors.textOnAccent,
};

const bodyStyle: React.CSSProperties = { flex: 1, minWidth: 0 };

const titleStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  fontWeight: typography.weights.semibold,
  lineHeight: 1.35,
};

const doneTitleStyle: React.CSSProperties = {
  ...titleStyle,
  color: colors.inkFaint,
  textDecoration: 'line-through',
};

const noteStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  lineHeight: 1.4,
  color: colors.inkMuted,
};

const doneNoteStyle: React.CSSProperties = { ...noteStyle, color: colors.inkFaint };

const duePillStyle: React.CSSProperties = {
  flex: 'none',
  padding: '5px 11px',
  borderRadius: radii.pill,
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  fontWeight: typography.weights.semibold,
  whiteSpace: 'nowrap',
  background: colors.porcelain,
  color: colors.inkMuted,
  boxShadow: `inset 0 0 0 1.5px ${colors.linenShade}`,
};

/** Due today, or overdue: the only claret pill on the card. */
const nowPillStyle: React.CSSProperties = {
  ...duePillStyle,
  background: colors.claret,
  color: colors.textOnAccent,
  boxShadow: 'none',
};

/** Inside the fortnight. */
const soonPillStyle: React.CSSProperties = {
  ...duePillStyle,
  background: '#FFF4E6',
  color: GOLD_INK,
  boxShadow: `inset 0 0 0 1.5px ${goldWash(0.45)}`,
};

/**
 * Valentin's line, pinned to the foot of the card.
 *
 * `marginTop: auto` is what lets this half stretch to the calendar's height
 * without leaving a hollow gap in the middle of the list — the pair is
 * `align-items: stretch` (see `global-styles.ts`), so one of the two has to
 * absorb the difference somewhere, and the bottom is the honest place.
 */
const fromMeStyle: React.CSSProperties = {
  marginTop: 'auto',
  display: 'flex',
  gap: 10,
  alignItems: 'flex-start',
  background: colors.porcelain,
  borderRadius: radii.kv,
  padding: '12px 14px',
  marginBottom: 0,
};

const fromMeEyebrowStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  fontWeight: typography.weights.semibold,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: colors.claret,
};

const fromMeTextStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  lineHeight: 1.45,
  color: colors.ink,
};

const emptyStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.body,
  lineHeight: 1.5,
  color: colors.inkMuted,
};

/**
 * `'Today'`, `'By Fri 11'`, `'No date'` — and `'Overdue'` when it has slipped.
 *
 * Relative rather than absolute for anything inside a fortnight, because "by
 * Friday" is the form a person plans in; past a fortnight the weekday alone stops
 * being enough to place and the date comes back.
 */
export function dueLabel(due: string | null | undefined, now: Date = new Date()): string {
  if (!due) return 'No date';
  const target = new Date(`${due}T00:00:00`);
  if (Number.isNaN(target.getTime())) return 'No date';

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);

  if (days < 0) return 'Overdue';
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days <= 14) {
    return `By ${target.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })}`;
  }
  return `By ${target.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
}

/** Which pill a due date earns. */
function pillStyleFor(label: string): React.CSSProperties {
  if (label === 'Today' || label === 'Overdue') return nowPillStyle;
  if (label === 'Tomorrow' || label.startsWith('By ')) return soonPillStyle;
  return duePillStyle;
}

interface WhatToDoNextProps {
  tasks: Task[];
  /** Ticks or un-ticks one row. */
  onToggle: (taskId: string) => void;
  /** Valentin's line under the list, when he has one. */
  note?: string | null;
  now?: Date;
}

export function WhatToDoNext({ tasks, onToggle, note, now = new Date() }: WhatToDoNextProps) {
  const open = openTasks(tasks);
  const done = doneTasks(tasks);
  const ordered = [...open, ...done];

  return (
    <section style={wrapperStyle} data-testid="dossier-what-to-do">
      <div style={cardHeadStyle}>
        <span style={{ color: colors.claret, display: 'flex' }} aria-hidden="true">
          <DossierIcon name="check" size={18} />
        </span>
        <h2 style={cardTitleStyle}>What to do next</h2>
        <span style={cardCountStyle}>{open.length} open</span>
      </div>

      {ordered.length === 0 ? (
        <p style={emptyStyle}>
          Nothing on the list. Say what you have to do — &ldquo;book somewhere by
          Friday&rdquo; — and I&rsquo;ll keep it here, ticked or not.
        </p>
      ) : (
        ordered.map((task, index) => {
          /*
           * A finished task has no deadline left to miss.
           *
           * `done` used to short-circuit only the pill's *style*, never its text, so
           * a row struck through as complete still read "Overdue" — and, because the
           * row is a button, that word was part of its accessible name too. Two of
           * the demo profile's ticked tasks shipped looking like failures.
           */
          const label = task.done ? 'Done' : dueLabel(task.due, now);
          return (
            <button
              key={task.id}
              type="button"
              style={index === 0 ? rowStyle : dividedRowStyle}
              onClick={() => onToggle(task.id)}
              aria-pressed={task.done}
              data-testid={`task-row-${task.id}`}
              data-done={task.done ? 'true' : 'false'}
            >
              <span style={task.done ? doneBoxStyle : boxStyle} aria-hidden="true">
                <DossierIcon name="check" size={16} />
              </span>
              <span style={bodyStyle}>
                <span style={task.done ? doneTitleStyle : titleStyle}>{task.title}</span>
                {task.note && (
                  <span style={task.done ? doneNoteStyle : noteStyle}>{task.note}</span>
                )}
              </span>
              <span style={task.done ? duePillStyle : pillStyleFor(label)}>{label}</span>
            </button>
          );
        })
      )}

      {note && (
        <div style={fromMeStyle} data-testid="what-to-do-from-me">
          <span style={{ color: colors.claret, display: 'flex', marginTop: 2 }} aria-hidden="true">
            <DossierIcon name="sparkle" size={18} />
          </span>
          <p style={fromMeTextStyle}>
            <span style={fromMeEyebrowStyle}>From me</span>
            {note}
          </p>
        </div>
      )}
    </section>
  );
}
