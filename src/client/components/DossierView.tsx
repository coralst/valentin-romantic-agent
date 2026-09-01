import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePreferencesContext } from '../context/preferences-context';
import { useProfileStoreContext } from '../context/profile-store-context';
import { useChatContext } from '../context/chat-context';
import { useOptionalDiscoveryContext } from '../context/discovery-context';
import { useViewContext } from '../context/view-context';
import { colors, insets, typography } from '../design-system/tokens';
import { PREFERENCE_CATEGORIES } from '../../shared/constants/categories';
import type { PreferenceWithHistory } from '../../shared/interfaces/preference';
import { getDateFields } from '../utils/profile-field-registry';
import { deriveOccasions } from '../utils/occasion-derivation';
import { rankUnfilledFields } from '../utils/field-payoff';
import { getAgeBucketFromValue } from '../utils/age-bucket';
import { formatBirthdayValue } from '../utils/birthday-display';
import { deriveCautions } from './brief/KeepInMind';
import { IdentityHeader } from './dossier/IdentityHeader';
import { HerSizes } from './dossier/HerSizes';
import { HerPalette } from './dossier/HerPalette';
import { GiftShortlist } from './dossier/GiftShortlist';
import { HerWeek } from './dossier/HerWeek';
import { FourWeekCalendar } from './dossier/FourWeekCalendar';
import { WhatToDoNext } from './dossier/WhatToDoNext';
import { DossierIcon, dossierType } from './dossier/dossier-icons';
import { EverythingIKnow } from './dossier/EverythingIKnow';
import { FamilyTree } from './dossier/FamilyTree';
import { PersonEditor, type PersonDraft } from './dossier/PersonEditor';
import { AlsoMentioned, groupUnmappedPreferences } from './dossier/AlsoMentioned';
import { useOptionalPeopleContext } from '../context/people-context';
import { useOptionalTasksContext } from '../context/tasks-context';
import type { Person, PersonGeneration } from '../../shared/interfaces/person';
import {
  parsePalette,
  parseShortlist,
  parseWeeklyRhythm,
} from '../utils/list-field-parsing';
import { buildAgenda, buildFourWeeks } from '../utils/four-week-calendar';

/**
 * Her file: three bands, read top to bottom, widest thing last.
 *
 *   1. the next four weeks   |   what to do next     (two halves)
 *   2. everything I know about her                   (full width)
 *   3. her family                                    (full width)
 *
 * WHY THIS AND NOT THE TRIAGE COLUMNS IT REPLACED. Those columns split one axis —
 * time — three ways and then swept every timeless fact into a third column that
 * was, honestly, a junk drawer. Two of the three also duplicated the brief rail,
 * which already counts the anniversary down. Now there is exactly one countdown in
 * the window, it lives in the rail, and the board is her portrait instead of a
 * to-do list wearing a portrait's clothes.
 *
 * WHY THE TREE IS LAST AND FULL WIDTH. It is the only thing here with real
 * structure — four generations and two gaps — and a tree drawn in a third of the
 * measure is just an indented list. Given the whole width it can draw branches.
 *
 * WHERE IT RENDERS. In the chat column, where a conversation renders, with the
 * conversation list and the brief rail still mounted beside it. It used to replace
 * columns 2–4 with one wide board, which cost the user both — see the note in
 * `context/view-context.tsx`.
 *
 * Every card reads from the same derivations the brief rail reads from
 * (`deriveOccasions`, `deriveCautions`, `rankUnfilledFields`), so the two surfaces
 * cannot disagree about what is known, what is next or what is dangerous. The
 * board adds editing and settling; it does not add facts.
 */

/**
 * The shell: a column flexbox whose header is pinned and whose board scrolls.
 *
 * `minWidth` / `minHeight: 0` because this is a grid child of the window and a
 * grid item's default `min-*: auto` sizes it to content — without them the board
 * grows to its full scroll height and pushes itself out of the window.
 */
const shellStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
  /*
   * The board's ground is `linen`, a shade under the cards on it.
   *
   * Not `porcelain`, which is what the chat column uses: the cards *are*
   * porcelain, and a porcelain board would leave them with nothing to sit on but
   * their own 1px shadow.
   */
  background: colors.linen,
};

/**
 * The scrolling board.
 *
 * `className="dossier-board"` is load-bearing: it is what makes this element the
 * container the pair below queries. See `global-styles.ts` — the breakpoint is the
 * board's own measure, not the window's, because the board's width is not a
 * function of window width alone.
 */
const boardStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  overflowY: 'auto',
  padding: `18px ${insets.snug}px 30px`,
};

const mobileBoardStyle: React.CSSProperties = {
  ...boardStyle,
  padding: `14px ${insets.tight}px 24px`,
};

/** The bands themselves: one column, generous gaps, nothing clever. */
const bandsStyle: React.CSSProperties = {
  display: 'grid',
  gap: 15,
};

const ledeStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 9,
  padding: '0 2px 14px',
  margin: 0,
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  lineHeight: 1.5,
  color: colors.inkMuted,
};

const ledeLeadStyle: React.CSSProperties = {
  fontWeight: typography.weights.semibold,
  color: colors.ink,
};

const editorSlotStyle: React.CSSProperties = { maxWidth: 520 };

interface DossierViewProps {
  /** Collapses the bands to one column and stacks the header. */
  isMobile?: boolean;
}

export function DossierView({ isMobile = false }: DossierViewProps) {
  const { state: preferencesState } = usePreferencesContext();
  const {
    state: profileState,
    dispatch: profileDispatch,
    getFieldValue,
  } = useProfileStoreContext();
  const { dispatch: chatDispatch } = useChatContext();
  const discovery = useOptionalDiscoveryContext();
  const { closeDossier, returnToChat } = useViewContext();

  /**
   * Escape closes her file, which also returns focus to her portrait in the brief.
   *
   * Bound on `document` rather than on the shell, because the user may well be
   * inside a `ProfileField` input three cards down when they give up on it.
   */
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDossier();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [closeDossier]);

  const name = getFieldValue('partner_name')?.value ?? null;
  const birthdayValue = getFieldValue('birthday')?.value ?? null;
  const zodiac = getFieldValue('zodiac_sign')?.value ?? null;

  const subtitle = useMemo(() => {
    const parts: string[] = [];
    if (birthdayValue) {
      const said = formatBirthdayValue(birthdayValue);
      if (said) parts.push(said);
      const bucket = getAgeBucketFromValue(birthdayValue);
      if (bucket) parts.push(bucket);
    }
    if (zodiac) parts.push(zodiac);
    return parts.length > 0 ? parts.join(' · ') : null;
  }, [birthdayValue, zodiac]);

  const dateFields = getDateFields();
  const occasions = useMemo(() => {
    const values: Record<string, { value: string } | undefined> = {};
    for (const field of dateFields) {
      const entry = getFieldValue(field.id);
      if (entry) values[field.id] = { value: entry.value };
    }
    return deriveOccasions(dateFields, values);
  }, [dateFields, getFieldValue]);

  /** Every preference, flattened out of its per-category buckets. */
  const allPreferences = useMemo(() => {
    const flat: PreferenceWithHistory[] = [];
    for (const category of PREFERENCE_CATEGORIES) {
      flat.push(...preferencesState.preferences[category]);
    }
    return flat;
  }, [preferencesState.preferences]);

  const cautions = useMemo(
    () => deriveCautions(getFieldValue, allPreferences),
    [getFieldValue, allPreferences],
  );

  const gaps = useMemo(
    () => rankUnfilledFields((fieldId) => getFieldValue(fieldId) !== null),
    [getFieldValue],
  );

  /*
   * Her people and his list.
   *
   * Optional contexts, like the profile store's: `DossierView` is mounted in tests
   * that provide none of the three, and a board with an empty family tree is a
   * correct empty state rather than a crash.
   */
  const people = useOptionalPeopleContext();
  const tasks = useOptionalTasksContext();
  const peopleList = people?.state.people ?? [];
  const taskList = tasks?.state.tasks ?? [];

  const rhythm = useMemo(
    () => parseWeeklyRhythm(getFieldValue('weekly_rhythm')?.value),
    [getFieldValue],
  );

  const calendar = useMemo(
    () => buildFourWeeks({ occasions, people: peopleList, tasks: taskList, rhythm }),
    [occasions, peopleList, taskList, rhythm],
  );

  const agenda = useMemo(
    () => buildAgenda({ occasions, people: peopleList, tasks: taskList }),
    [occasions, peopleList, taskList],
  );

  /**
   * The faint-dot legend under the grid, built from her own week.
   *
   * Phrased from the entries rather than hardcoded, so a session that never
   * mentioned pottery does not claim she does any.
   */
  const rhythmNote = useMemo(() => {
    if (rhythm.length === 0) return null;
    const said = rhythm
      .filter((entry) => entry.label.length > 0)
      .slice(0, 2)
      .map((entry) => entry.label);
    if (said.length === 0) return null;
    return `Faint dots — ${said.join(', and ')}.`;
  }, [rhythm]);

  const palette = useMemo(
    () => parsePalette(getFieldValue('color_palette')?.value),
    [getFieldValue],
  );

  const shortlist = useMemo(
    () => parseShortlist(getFieldValue('gift_shortlist')?.value),
    [getFieldValue],
  );

  /**
   * Ask on the user's behalf by *filling the composer*, never by sending.
   *
   * Identical to the rail's `askAbout`: Valentin is the one who asks questions
   * here, so the user sees and can edit the line before it goes.
   */
  /*
   * `returnToChat` alongside every `SET_INPUT` on this surface.
   *
   * The composer that renders `inputValue` is `MessageInput`, inside `ChatPanel`
   * — and `AppLayout` unmounts `ChatPanel` for as long as her file is up. So the
   * line was written into state nobody was displaying: the user pressed an ask
   * button, the dossier did not move, no text appeared, and the prompt was
   * waiting in a composer they had to go and find. `returnToChat` is the
   * existing "take me to the conversation" — it leaves the dossier and puts the
   * caret in the composer, which is where the line now visibly is.
   */
  const askAbout = useCallback(
    (label: string) => {
      chatDispatch({
        type: 'SET_INPUT',
        value: `Ask me about her ${label.toLowerCase()}.`,
      });
      returnToChat();
    },
    [chatDispatch, returnToChat],
  );

  /**
   * "Ask me what's missing" — the header CTA.
   *
   * Names the top three gaps rather than saying "ask me everything", so the reply
   * is a conversation and not a questionnaire.
   */
  const askWhatsMissing = useCallback(() => {
    const top = gaps.slice(0, 3).map((gap) => gap.label.toLowerCase());
    const value =
      top.length === 0
        ? 'What else would help you plan something for her?'
        : `Ask me about her ${top.join(', ')}.`;
    chatDispatch({ type: 'SET_INPUT', value });
    // The header's primary CTA. Without this it was the most prominent button on
    // the surface and the one that appeared to do the least.
    returnToChat();
  }, [gaps, chatDispatch, returnToChat]);

  const saveField = useCallback(
    (fieldId: string, value: string) => {
      profileDispatch({ type: 'SET_MANUAL_VALUE', fieldId, value });
    },
    [profileDispatch],
  );

  const clearField = useCallback(
    (fieldId: string) => {
      profileDispatch({ type: 'CLEAR_MANUAL_VALUE', fieldId });
    },
    [profileDispatch],
  );

  /** Who is being edited. Local state: it is a mode, not a fact about her. */
  const [editing, setEditing] = useState<
    { person: Person | null; generation: PersonGeneration } | null
  >(null);

  const savePerson = useCallback(
    (draft: PersonDraft) => {
      if (!people || !editing) return;
      if (editing.person) {
        people.dispatch({ type: 'UPDATE_PERSON', id: editing.person.id, patch: draft });
      } else {
        people.addPerson({ ...draft, source: 'manual' });
      }
      setEditing(null);
    },
    [people, editing],
  );

  const removePerson = useCallback(() => {
    if (!people || !editing?.person) return;
    people.dispatch({ type: 'REMOVE_PERSON', id: editing.person.id });
    setEditing(null);
  }, [people, editing]);

  /**
   * A gap turns into a question in the composer rather than into a form.
   *
   * Pressing a dashed node could open the editor with the name focused, but the
   * reason the name is missing is usually that you don't know it — so the useful
   * move is to have Valentin ask her about it in conversation, which is where the
   * answer will come from.
   */
  const askAboutPerson = useCallback(
    (person: Person) => {
      chatDispatch({
        type: 'SET_INPUT',
        value: `Remind me — what's her ${person.relationship.toLowerCase()}'s name?`,
      });
      returnToChat();
    },
    [chatDispatch, returnToChat],
  );

  /**
   * Ticking a row is the one write on this board that is not about her.
   *
   * Guarded rather than assumed: without the provider the card still renders its
   * empty state, and a checkbox that threw on click would be worse than one that
   * cannot be ticked.
   */
  const toggleTask = useCallback(
    (taskId: string) => {
      tasks?.toggleTask(taskId);
    },
    [tasks],
  );

  /**
   * Valentin's line under the list.
   *
   * The first open row is the one everything else waits on, so the note says so
   * rather than repeating the row. Null when the list is empty — a nudge about
   * nothing is noise.
   */
  const fromMe = useMemo(() => {
    const firstOpen = taskList.find((task) => !task.done);
    if (!firstOpen) return null;
    return `Do “${firstOpen.title}” first and the rest gets easier. Most of this list waits on her answer.`;
  }, [taskList]);

  /**
   * Whether anything was extracted that no registry field could hold.
   *
   * Computed here rather than inside the card so the band can be absent entirely
   * instead of rendering a heading over an empty state.
   */
  const unmapped = useMemo(() => groupUnmappedPreferences(allPreferences), [allPreferences]);

  const tiles = (
    <>
      <HerSizes getFieldValue={getFieldValue} onAsk={askAbout} />
      <HerPalette
        shades={palette}
        caution={cautions[0]?.title ?? null}
        onAsk={() => askAbout('palette')}
      />
      <GiftShortlist
        items={shortlist}
        budget={getFieldValue('gift_budget')?.value ?? null}
        onAsk={() => askAbout('gift shortlist')}
      />
      <HerWeek entries={rhythm} onAsk={() => askAbout('week')} />
    </>
  );

  return (
    <div style={shellStyle} data-testid="dossier-view">
      <IdentityHeader
        name={name}
        subtitle={subtitle}
        onBack={closeDossier}
        onAskAll={askWhatsMissing}
        isMobile={isMobile}
      />

      <div
        className="dossier-board"
        style={isMobile ? mobileBoardStyle : boardStyle}
        data-testid="dossier-board"
        data-columns={isMobile ? 1 : 12}
      >
        <p style={ledeStyle}>
          <span style={{ color: colors.claret, display: 'flex' }} aria-hidden="true">
            <DossierIcon name="book" size={18} />
          </span>
          <span>
            <span style={ledeLeadStyle}>Her file.</span> The four weeks in front of
            you, what to do about them, everything I know about her, and her family
            — in that order.
          </span>
        </p>

        <div style={bandsStyle} data-testid="dossier-bands">
          {/* Band one. `dossier-pair` is a real class, not an inline style: the
              two halves stack on a container query, which inline styles cannot
              express. On mobile they are one column already. */}
          <div
            className={isMobile ? undefined : 'dossier-pair'}
            style={isMobile ? bandsStyle : undefined}
            data-testid="dossier-band-pair"
          >
            <FourWeekCalendar
              calendar={calendar}
              agenda={agenda}
              rhythmNote={rhythmNote}
            />
            <WhatToDoNext tasks={taskList} onToggle={toggleTask} note={fromMe} />
          </div>

          {/* Band two. The four tiles ride inside this card rather than forming a
              band of their own: they are four of her facts given pictures, and the
              rest of her facts are directly below them. */}
          <EverythingIKnow
            getFieldValue={getFieldValue}
            onSaveField={saveField}
            onClearField={clearField}
            highlightedFieldIds={discovery?.highlightedFieldIds}
            onAsk={(field) => askAbout(field.label)}
            isMobile={isMobile}
            tiles={tiles}
          />

          {/* Band three. */}
          <FamilyTree
            people={peopleList}
            partnerName={name}
            partnerBirthday={birthdayValue}
            onSelectPerson={(person) =>
              setEditing({ person, generation: person.generation })
            }
            onAddPerson={(generation) => setEditing({ person: null, generation })}
            onAskAboutGap={askAboutPerson}
          />

          {/*
            * Last, and quietest — but not dropped.
            *
            * The mockup has no card for this, and it is still here, because what it
            * holds is real extraction output that resolves to no registry field:
            * `hobbies: "she collects vinyl"` lands in the store with nowhere else on
            * screen to go. Deleting the card would not simplify the board, it would
            * silently lose her words. It sits below the tree because it is the least
            * consequential thing here, and it renders nothing when there is nothing.
            */}
          {unmapped.length > 0 && <AlsoMentioned preferences={allPreferences} />}

          {editing && (
            <div style={isMobile ? undefined : editorSlotStyle}>
              <PersonEditor
                person={editing.person}
                generation={editing.generation}
                onSave={savePerson}
                onCancel={() => setEditing(null)}
                onRemove={editing.person ? removePerson : undefined}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
