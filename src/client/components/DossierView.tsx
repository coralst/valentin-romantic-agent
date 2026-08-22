import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePreferencesContext } from '../context/preferences-context';
import { useProfileStoreContext } from '../context/profile-store-context';
import { useChatContext } from '../context/chat-context';
import { useOptionalDiscoveryContext } from '../context/discovery-context';
import { useViewContext } from '../context/view-context';
import { colors, insets, radii, typography } from '../design-system/tokens';
import { PREFERENCE_CATEGORIES } from '../../shared/constants/categories';
import type { PreferenceWithHistory } from '../../shared/interfaces/preference';
import { PROFILE_FIELD_REGISTRY, getDateFields } from '../utils/profile-field-registry';
import {
  deriveOccasions,
  getDaysUntilOccasion,
  getNextOccasion,
} from '../utils/occasion-derivation';
import { deriveTogetherDays, formatTogetherDays } from '../utils/together-days';
import { rankUnfilledFields, type FieldGap } from '../utils/field-payoff';
import { getAgeBucketFromValue } from '../utils/age-bucket';
import { formatBirthdayValue } from '../utils/birthday-display';
import { deriveCautions } from './brief/KeepInMind';
import { IdentityHeader } from './dossier/IdentityHeader';
import {
  BOARD_HALF,
  BOARD_THIRD,
  BOARD_TWO_THIRDS,
  CardBoard,
  span,
  spanAllStyle,
} from './dossier/CardBoard';
import { StatBar, type Stat } from './dossier/StatBar';
import { DossierTabs, type DossierTab, type TabDefinition } from './dossier/DossierTabs';
import { WhatsComing } from './dossier/WhatsComing';
import { KeepInMindCard } from './dossier/KeepInMindCard';
import { ConfirmMyGuesses, deriveGuesses, type Guess } from './dossier/ConfirmMyGuesses';
import { WorthAskingNext } from './dossier/WorthAskingNext';
import { AlsoMentioned } from './dossier/AlsoMentioned';
import { EverythingIKnow } from './dossier/EverythingIKnow';
import { FamilyTree } from './dossier/FamilyTree';
import { TheirBirthdays } from './dossier/TheirBirthdays';
import { PersonEditor, type PersonDraft } from './dossier/PersonEditor';
import { useOptionalPeopleContext } from '../context/people-context';
import type { Person, PersonGeneration } from '../../shared/interfaces/person';
import { countGaps } from '../utils/people-derivation';

/*
 * "17 June 1988 · mid-thirties · Gemini" — the same subtitle the rail builds, from
 * the same guarded formatter. See `birthday-display.ts`.
 */

/**
 * The shell: a column flexbox whose first child is pinned and whose second
 * scrolls (`full-profile.html:21-22`).
 *
 * `minWidth` / `minHeight: 0` because this is a grid child of the window and a
 * grid item's default `min-*: auto` sizes it to content — without them the board
 * grows to its full scroll height and pushes itself out of the window, which is
 * the same bug Stage 3 hit in the chat column.
 */
const shellStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
  background: colors.porcelain,
};

/** `.vsay` — Valentin's line at the foot of the board (`full-profile.html:222`). */
const sayStyle: React.CSSProperties = {
  ...spanAllStyle,
  display: 'flex',
  alignItems: 'center',
  gap: 13,
  padding: `${insets.tight}px ${insets.snug}px`,
  borderRadius: radii.card,
  background: colors.vitrineSayGradient,
  boxShadow: `inset 0 0 0 1px rgba(176, 140, 79, 0.28)`,
  minWidth: 0,
};

/** Mobile: one column already, so no span — but it keeps its own card styling. */
const mobileSayStyle: React.CSSProperties = {
  ...sayStyle,
  gridColumn: 'auto',
  flexWrap: 'wrap',
  gap: 11,
  padding: `${insets.tight}px`,
};

const sayCrestStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  flex: 'none',
  borderRadius: radii.pill,
  overflow: 'hidden',
  background: colors.porcelain,
  boxShadow: '0 1px 5px rgba(74, 24, 38, 0.22)',
};

const sayCrestImageStyle: React.CSSProperties = {
  width: '122%',
  height: '122%',
  objectFit: 'cover',
};

const sayBodyStyle: React.CSSProperties = { flex: 1, minWidth: 0 };

const sayEyebrowStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.eyebrow,
  fontWeight: typography.weights.semibold,
  letterSpacing: '0.22em',
  textTransform: 'uppercase',
  color: 'rgba(122, 92, 34, 0.8)',
};

const sayTextStyle: React.CSSProperties = {
  margin: '4px 0 0',
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.smallLoose,
  lineHeight: 1.5,
  color: colors.ink,
};

const sayButtonStyle: React.CSSProperties = {
  flex: 'none',
  border: 'none',
  cursor: 'pointer',
  borderRadius: radii.pill,
  padding: '9px 15px',
  background: colors.claret,
  color: colors.textOnAccent,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.labelLoose,
  fontWeight: typography.weights.medium,
  whiteSpace: 'nowrap',
};

interface DossierViewProps {
  /** Collapses the board to one column and stacks the header. */
  isMobile?: boolean;
}

/**
 * The full-page dossier: columns 2–4 of the window, replaced.
 *
 * Not a portal and not a route. It shares the icon rail and the window's own
 * chrome (`full-profile.html:19`), so it is a *sibling* of the chat column in the
 * same grid — see the long note in `context/view-context.tsx` for why a portal
 * and a persisted URL were both rejected.
 *
 * Every card reads from the same derivations the brief rail reads from
 * (`deriveOccasions`, `deriveCautions`, `rankUnfilledFields`), so the two
 * surfaces cannot disagree about what is known, what is next or what is
 * dangerous. The dossier adds editing and settling; it does not add facts.
 */
export function DossierView({ isMobile = false }: DossierViewProps) {
  const { state: preferencesState } = usePreferencesContext();
  const {
    state: profileState,
    dispatch: profileDispatch,
    getFieldValue,
  } = useProfileStoreContext();
  const { state: chatState, dispatch: chatDispatch } = useChatContext();
  const discovery = useOptionalDiscoveryContext();
  const { closeDossier } = useViewContext();

  /**
   * Escape closes the dossier, which also returns focus to the rail's ♥.
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

  const total = PROFILE_FIELD_REGISTRY.length;
  const filled = PROFILE_FIELD_REGISTRY.filter(
    (field) => getFieldValue(field.id) !== null,
  ).length;

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

  const guesses = useMemo(
    () =>
      deriveGuesses(
        allPreferences,
        chatState.messages,
        (fieldId) => getFieldValue(fieldId)?.source === 'manual',
        (fieldId) => profileState.rejectedFieldIds.includes(fieldId),
      ),
    [allPreferences, chatState.messages, getFieldValue, profileState.rejectedFieldIds],
  );

  /**
   * Ask on the user's behalf by *filling the composer*, never by sending.
   *
   * Identical to the rail's `askAbout`: Valentin is the one who asks questions
   * here, so the user sees and can edit the line before it goes.
   */
  const askAbout = useCallback(
    (label: string) => {
      chatDispatch({
        type: 'SET_INPUT',
        value: `Ask me about her ${label.toLowerCase()}.`,
      });
    },
    [chatDispatch],
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
  }, [gaps, chatDispatch]);

  /**
   * ✓ — promote the guess to a stated fact at the *same* value.
   *
   * `SET_MANUAL_VALUE` is what promotes it: manual values win over discovered
   * ones in `getFieldValue` and are never revisited by ingestion, so the guess
   * leaves the pile and stays gone.
   */
  const confirmGuess = useCallback(
    (guess: Guess) => {
      if (!guess.fieldId) return;
      profileDispatch({
        type: 'SET_MANUAL_VALUE',
        fieldId: guess.fieldId,
        value: guess.value,
      });
    },
    [profileDispatch],
  );

  /**
   * ✗ — drop it, so Valentin stops acting on it.
   *
   * `CLEAR_DISCOVERED_VALUE`, not `CLEAR_MANUAL_VALUE`: a rejected guess has no
   * manual value, and clearing the manual slot would *reveal* the discovered
   * value underneath rather than remove it.
   */
  const rejectGuess = useCallback(
    (guess: Guess) => {
      if (!guess.fieldId) return;
      profileDispatch({ type: 'CLEAR_DISCOVERED_VALUE', fieldId: guess.fieldId });
    },
    [profileDispatch],
  );

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

  const topGap: FieldGap | null = gaps[0] ?? null;

  /*
   * Her people.
   *
   * Optional context, like the profile store's: `DossierView` is mounted in tests
   * that provide neither, and a board with an empty family tree is a correct
   * empty state rather than a crash.
   */
  const people = useOptionalPeopleContext();
  const peopleList = people?.state.people ?? [];
  const peopleGaps = countGaps(peopleList);

  /**
   * Which tab is showing, and who is being edited.
   *
   * Local state, not the URL and not a context: the dossier is already a
   * non-routed sibling of the chat column (see the note above), and a tab you
   * left on last time is not something you want restored three days later.
   */
  const [activeTab, setActiveTab] = useState<DossierTab>('overview');
  const [editing, setEditing] = useState<
    { person: Person | null; generation: PersonGeneration } | null
  >(null);

  const togetherDays = useMemo(
    () => deriveTogetherDays(getFieldValue('anniversary')?.value ?? null),
    [getFieldValue],
  );

  const nextOccasion = useMemo(() => getNextOccasion(occasions), [occasions]);

  /**
   * The four figures on the command bar.
   *
   * Each one is either a real number or absent — never a zero standing in for
   * "unknown", which is the difference between "you have been together 0 days"
   * and "I don't know when you started".
   */
  const stats = useMemo<Stat[]>(() => {
    const list: Stat[] = [];

    if (togetherDays !== null) {
      list.push({
        value: formatTogetherDays(togetherDays),
        label: 'Days together',
        tone: 'date',
      });
    }

    if (nextOccasion) {
      const days = getDaysUntilOccasion(nextOccasion);
      list.push({
        value: days === 0 ? 'Today' : `${days}d`,
        label: 'Next occasion',
        tone: 'gift',
        note: nextOccasion.label,
      });
    }

    list.push({
      value: `${Math.round((filled / Math.max(total, 1)) * 100)}%`,
      label: 'How well I know her',
      tone: 'grow',
      note: `${filled} of ${total} known`,
    });

    if (peopleList.length > 0) {
      list.push({
        value: String(peopleList.length),
        label: 'Her people',
        tone: 'kin',
        note: peopleGaps > 0 ? `${peopleGaps} still unnamed` : null,
      });
    }

    return list;
  }, [togetherDays, nextOccasion, filled, total, peopleList.length, peopleGaps]);

  const tabs = useMemo<TabDefinition[]>(
    () => [
      { id: 'overview', label: 'Overview', tone: 'date' },
      { id: 'known', label: 'Everything I know', count: filled, tone: 'fact' },
      { id: 'gifts', label: 'To do', count: guesses.length + gaps.length, tone: 'gift' },
      { id: 'people', label: 'Her people', count: peopleList.length, tone: 'kin' },
      { id: 'memories', label: 'Mentioned', count: allPreferences.length, tone: 'mood' },
    ],
    [filled, guesses.length, gaps.length, peopleList.length, allPreferences.length],
  );

  /** Every tab shows the overview's cards too when it is the overview. */
  const shows = useCallback(
    (...tabsShowingIt: DossierTab[]) => tabsShowingIt.includes(activeTab),
    [activeTab],
  );

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
    },
    [chatDispatch],
  );

  return (
    <div style={shellStyle} data-testid="dossier-view">
      <IdentityHeader
        name={name}
        subtitle={subtitle}
        filled={filled}
        total={total}
        onBack={closeDossier}
        onAskAll={askWhatsMissing}
        isMobile={isMobile}
      />

      <StatBar stats={stats} isMobile={isMobile} />

      <DossierTabs
        tabs={tabs}
        active={activeTab}
        onSelect={setActiveTab}
        isMobile={isMobile}
      />

      <CardBoard isMobile={isMobile}>
        {/*
         * The wide span is earned, not fixed.
         *
         * Found in the partial-profile screenshots, which the 18/18 demo seed hides:
         * with no dates known, `What's coming` is a single line of prose, and
         * spanning it across two-thirds of the board left a ~330px void beneath it,
         * because a grid row is still as tall as its tallest member no matter how
         * the items are aligned within it. Empty, it takes one column like
         * everything else and the short cards simply sit at the top of their own
         * columns — which is what `align-items: start` is for. Populated, it needs
         * the width for the spine, the dates and the act-by chips, so it takes it
         * back.
         */}
        {shows('overview', 'gifts') && (
          <div
            style={
              isMobile
                ? undefined
                : occasions.length === 0
                  ? span(BOARD_THIRD)
                  : span(BOARD_TWO_THIRDS)
            }
            data-testid="dossier-whats-coming-slot"
          >
            <WhatsComing occasions={occasions} />
          </div>
        )}

        {shows('overview', 'gifts') && (
          <div style={isMobile ? undefined : span(BOARD_THIRD)}>
            <KeepInMindCard cautions={cautions} />
          </div>
        )}

        {/*
         * Her people, on the overview as well as on their own tab.
         *
         * The tree is the widest card on the board because it is a *diagram*: at a
         * third of the width its three rows wrap into an unreadable stack, which
         * loses the only thing a drawing gives you over a list.
         */}
        {shows('overview', 'people') && (
          <div style={isMobile ? undefined : span(BOARD_TWO_THIRDS)}>
            <FamilyTree
              people={peopleList}
              partnerName={name}
              onSelectPerson={(person) =>
                setEditing({ person, generation: person.generation })
              }
              onAddPerson={(generation) => setEditing({ person: null, generation })}
              onAskAboutGap={askAboutPerson}
            />
          </div>
        )}

        {shows('overview', 'people') && (
          <div style={isMobile ? undefined : span(BOARD_THIRD)}>
            <TheirBirthdays
              people={peopleList}
              onSelectPerson={(person) =>
                setEditing({ person, generation: person.generation })
              }
            />
          </div>
        )}

        {editing && (
          <div style={isMobile ? undefined : span(BOARD_HALF)}>
            <PersonEditor
              person={editing.person}
              generation={editing.generation}
              onSave={savePerson}
              onCancel={() => setEditing(null)}
              onRemove={editing.person ? removePerson : undefined}
            />
          </div>
        )}

        {shows('overview', 'gifts') && (
          <div style={isMobile ? undefined : span(BOARD_THIRD)}>
            <ConfirmMyGuesses
              guesses={guesses}
              onConfirm={confirmGuess}
              onReject={rejectGuess}
            />
          </div>
        )}

        {shows('overview', 'gifts') && (
          <div style={isMobile ? undefined : span(BOARD_THIRD)}>
            <WorthAskingNext gaps={gaps} onAsk={(gap) => askAbout(gap.label)} />
          </div>
        )}

        {shows('memories') && (
          <div style={isMobile ? undefined : span(BOARD_HALF)}>
            <AlsoMentioned preferences={allPreferences} />
          </div>
        )}

        {shows('overview', 'known') && (
          <div style={isMobile ? undefined : spanAllStyle}>
            <EverythingIKnow
              getFieldValue={getFieldValue}
              onSaveField={saveField}
              onClearField={clearField}
              highlightedFieldIds={discovery?.highlightedFieldIds}
              onAsk={(field) => askAbout(field.label)}
              isMobile={isMobile}
            />
          </div>
        )}

        {topGap && shows('overview') && (
          <div style={isMobile ? mobileSayStyle : sayStyle} data-testid="dossier-say">
            <div style={sayCrestStyle}>
              <img src="/logo.png" alt="" style={sayCrestImageStyle} />
            </div>
            <div style={sayBodyStyle}>
              <span style={sayEyebrowStyle}>Valentin suggests</span>
              <p style={sayTextStyle}>{topGap.reason}</p>
            </div>
            <button
              type="button"
              style={sayButtonStyle}
              onClick={() => askAbout(topGap.label)}
              data-testid="dossier-say-ask"
            >
              Let&rsquo;s talk about it
            </button>
          </div>
        )}
      </CardBoard>
    </div>
  );
}
