import { useEffect, useRef, useState } from 'react';
import { colors, radii, typography } from '../../design-system/tokens';
import type { Person, PersonGeneration } from '../../../shared/interfaces/person';
import { cardHeadStyle, cardTitleStyle } from './board-tones';
import { toneGlyphStyle, tonedCardStyle } from './accent-tones';
import { DossierIcon, dossierType } from './dossier-icons';

/**
 * The form behind every node on the family tree.
 *
 * Inline on the board rather than in a modal: the tree is the context for what
 * you are typing — you are looking at the row you are adding to — and a modal
 * would cover it. Escape closes, so it costs nothing to open by accident.
 *
 * The name field may be left empty on purpose. That is how you record "she has a
 * brother and I have never caught his name": the person is saved as a gap, the
 * tree draws them dashed, and Valentin gets a question to ask.
 */

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  fontWeight: typography.weights.medium,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: colors.inkFaint,
  marginBottom: 5,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '9px 11px',
  borderRadius: radii.kv,
  border: `1px solid ${colors.linenShade}`,
  background: colors.porcelain,
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  color: colors.ink,
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: 11,
};

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 9,
  marginTop: 14,
};

const saveStyle: React.CSSProperties = {
  border: 'none',
  cursor: 'pointer',
  borderRadius: radii.pill,
  padding: '9px 17px',
  background: '#A05A7A',
  color: colors.textOnAccent,
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  fontWeight: typography.weights.medium,
};

const quietStyle: React.CSSProperties = {
  border: `1px solid ${colors.linenShade}`,
  cursor: 'pointer',
  borderRadius: radii.pill,
  padding: '9px 15px',
  background: 'transparent',
  color: colors.inkMuted,
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  fontWeight: typography.weights.medium,
};

const removeStyle: React.CSSProperties = {
  ...quietStyle,
  marginLeft: 'auto',
  border: 'none',
  color: colors.error,
};

const hintStyle: React.CSSProperties = {
  margin: '11px 0 0',
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  lineHeight: 1.5,
  color: colors.inkMuted,
};

// Longer than the tree's own labels on purpose: these are the options in a
// picker, where the user has to choose between them, not headings above rows
// where the people underneath already say which rung is which.
const GENERATION_LABELS: Record<PersonGeneration, string> = {
  grandparent: 'Her grandparents’ generation',
  elder: 'Her parents’ generation',
  peer: 'Her own generation',
  younger: 'Younger — children, nieces, pets',
};

/** What we hand back on save. `id` is absent for a new person. */
export interface PersonDraft {
  name: string | null;
  relationship: string;
  generation: PersonGeneration;
  birthday: string | null;
  note: string | null;
}

interface PersonEditorProps {
  /** The person being edited, or null when adding. */
  person: Person | null;
  /** Which row a new person lands on. Ignored when editing. */
  generation: PersonGeneration;
  onSave: (draft: PersonDraft) => void;
  onCancel: () => void;
  /** Absent when adding — there is nothing yet to remove. */
  onRemove?: () => void;
}

export function PersonEditor({
  person,
  generation,
  onSave,
  onCancel,
  onRemove,
}: PersonEditorProps) {
  const [name, setName] = useState(person?.name ?? '');
  const [relationship, setRelationship] = useState(person?.relationship ?? '');
  const [birthday, setBirthday] = useState(person?.birthday ?? '');
  const [note, setNote] = useState(person?.note ?? '');
  const [row, setRow] = useState<PersonGeneration>(person?.generation ?? generation);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // Focus the name on open: the editor is opened by a deliberate press, so the
  // caret belongs in the field that press was about.
  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Stop the dossier's own Escape handler from closing the whole page
        // behind the editor — one Escape should close one thing.
        event.stopPropagation();
        onCancel();
      }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => document.removeEventListener('keydown', handleKey, true);
  }, [onCancel]);

  const trimmedRelationship = relationship.trim();
  const canSave = trimmedRelationship.length > 0;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    const trimmedName = name.trim();
    onSave({
      // Empty is not an accident here — it is how a gap is recorded.
      name: trimmedName.length > 0 ? trimmedName : null,
      relationship: trimmedRelationship,
      generation: row,
      birthday: birthday.trim().length > 0 ? birthday : null,
      note: note.trim().length > 0 ? note.trim() : null,
    });
  };

  return (
    <form
      style={tonedCardStyle('kin', { tinted: true })}
      onSubmit={submit}
      data-testid="person-editor"
    >
      <div style={cardHeadStyle}>
        <span style={toneGlyphStyle('kin')} aria-hidden="true">
          <DossierIcon name="people" size={16} />
        </span>
        <h2 style={cardTitleStyle}>{person ? 'Edit' : 'Add someone'}</h2>
      </div>

      <div style={gridStyle}>
        <label>
          <span style={labelStyle}>Name</span>
          <input
            ref={firstFieldRef}
            style={inputStyle}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Leah"
            data-testid="person-name"
          />
        </label>

        <label>
          <span style={labelStyle}>How she&rsquo;s related *</span>
          <input
            style={inputStyle}
            value={relationship}
            onChange={(event) => setRelationship(event.target.value)}
            placeholder="Older sister"
            required
            data-testid="person-relationship"
          />
        </label>

        <label>
          <span style={labelStyle}>Birthday</span>
          <input
            type="date"
            style={inputStyle}
            value={birthday ? birthday.slice(0, 10) : ''}
            onChange={(event) => setBirthday(event.target.value)}
            data-testid="person-birthday"
          />
        </label>

        <label>
          <span style={labelStyle}>Row</span>
          <select
            style={inputStyle}
            value={row}
            onChange={(event) => setRow(event.target.value as PersonGeneration)}
            data-testid="person-generation"
          >
            {(Object.keys(GENERATION_LABELS) as PersonGeneration[]).map((key) => (
              <option key={key} value={key}>
                {GENERATION_LABELS[key]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label style={{ display: 'block', marginTop: 11 }}>
        <span style={labelStyle}>Anything worth remembering</span>
        <input
          style={inputStyle}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Goes by Mimi · lives in Berlin"
          data-testid="person-note"
        />
      </label>

      <div style={actionsStyle}>
        <button type="submit" style={saveStyle} disabled={!canSave} data-testid="person-save">
          {person ? 'Save' : 'Add them'}
        </button>
        <button type="button" style={quietStyle} onClick={onCancel} data-testid="person-cancel">
          Cancel
        </button>
        {onRemove && (
          <button
            type="button"
            style={removeStyle}
            onClick={onRemove}
            data-testid="person-remove"
          >
            Remove
          </button>
        )}
      </div>

      <p style={hintStyle}>
        Leave the name empty to record someone you haven&rsquo;t caught the name of
        yet — they&rsquo;ll show as a gap on the tree and I&rsquo;ll ask you about
        them.
      </p>
    </form>
  );
}
