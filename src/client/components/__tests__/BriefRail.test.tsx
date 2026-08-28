import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BriefRail } from '../BriefRail';
import { ChatProvider } from '../../context/chat-context';
import { PreferencesProvider, usePreferencesContext } from '../../context/preferences-context';
import {
  ProfileStoreProvider,
  useProfileStoreContext,
} from '../../context/profile-store-context';
import { PROFILE_FIELD_REGISTRY } from '../../utils/profile-field-registry';
import type { PreferenceWithHistory } from '../../../shared/interfaces/preference';

/** A value to write into the profile store before the rail renders. */
interface SeedField {
  fieldId: string;
  value: string;
}

/**
 * Writes seed data into the real stores, then renders the rail against them.
 *
 * The stores are used rather than mocked because the rail's whole job is
 * deriving copy from them: a mocked `getFieldValue` would let a broken
 * derivation pass.
 */
function Seeder({ fields, preferences }: { fields: SeedField[]; preferences: PreferenceWithHistory[] }) {
  const { dispatch: profileDispatch } = useProfileStoreContext();
  const { dispatch: preferencesDispatch } = usePreferencesContext();
  const seeded = useSeedOnce(() => {
    for (const field of fields) {
      profileDispatch({ type: 'SET_MANUAL_VALUE', fieldId: field.fieldId, value: field.value });
    }
    if (preferences.length > 0) {
      preferencesDispatch({ type: 'LOAD_PREFERENCES', preferences });
    }
  });
  return seeded ? <BriefRail /> : null;
}

/** Run the seed synchronously on first render, so the rail never sees an empty store. */
function useSeedOnce(seed: () => void): boolean {
  const ref = useRefLike();
  if (!ref.done) {
    ref.done = true;
    seed();
  }
  return true;
}

const refs = { done: false };
function useRefLike() {
  return refs;
}

function renderRail(fields: SeedField[] = [], preferences: PreferenceWithHistory[] = []) {
  refs.done = false;
  return render(
    <ChatProvider>
      <PreferencesProvider>
        <ProfileStoreProvider sessionId={null}>
          <Seeder fields={fields} preferences={preferences} />
        </ProfileStoreProvider>
      </PreferencesProvider>
    </ChatProvider>,
  );
}

function preference(overrides: Partial<PreferenceWithHistory>): PreferenceWithHistory {
  return {
    id: 'pref-1',
    sessionId: 'session-1',
    category: 'food',
    key: 'allergies',
    value: 'shellfish',
    confidence: 0.95,
    sourceMessageId: 'msg-1',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    history: [],
    ...overrides,
  };
}

/**
 * React reports a duplicate/missing `key` through `console.error` rather than by
 * throwing, so a render bug like that passes a green suite silently. Spying lets
 * the key regression test below assert on it.
 */
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe('BriefRail — legacy selector aliasing', () => {
  it('answers to both brief-rail and the old partner-profile-panel id', () => {
    // Not cosmetic: AppLayout.test.tsx and two Playwright specs select the
    // profile surface by the old name, and e2e/ is not this component's lane.
    renderRail();
    expect(screen.getByTestId('brief-rail')).toBeInTheDocument();
    expect(screen.getByTestId('partner-profile-panel')).toBeInTheDocument();
  });

  it('nests the rail inside the alias wrapper, so both resolve to a real box', () => {
    renderRail();
    const alias = screen.getByTestId('partner-profile-panel');
    expect(alias).toContainElement(screen.getByTestId('brief-rail'));
  });

  it('keeps the empty-state copy the onboarding spec asserts on', () => {
    renderRail();
    const empty = screen.getByTestId('empty-encouragement');
    expect(empty).toBeInTheDocument();
    expect(empty.textContent).toContain('Keep chatting with Valentin');
  });
});

describe('BriefRail — zero state', () => {
  it('shows the encouragement instead of the modules when nothing is known', () => {
    renderRail();
    expect(screen.queryByTestId('brief-next-up')).not.toBeInTheDocument();
    expect(screen.queryByTestId('brief-good-to-know')).not.toBeInTheDocument();
  });

  it('still pins the nudge and the tally, which is what they are pinned for', () => {
    renderRail();
    expect(screen.getByTestId('brief-nudge')).toBeInTheDocument();
    expect(screen.getByTestId('brief-tally')).toBeInTheDocument();
  });

  it('falls back to a heading rather than a blank where her name goes', () => {
    renderRail();
    expect(screen.getByText('Her brief')).toBeInTheDocument();
  });

  /**
   * The zero state shows the *shape* of the brief.
   *
   * A fresh account used to get one paragraph in a 306px claret column and
   * nothing else. You cannot watch a panel fill in if you have never seen what
   * it is going to fill in with.
   */
  it('shows the labelled placeholder rows instead of an empty column', () => {
    renderRail();
    expect(screen.getByTestId('brief-skeleton')).toBeInTheDocument();
    expect(screen.getAllByTestId('brief-skeleton-row').length).toBeGreaterThan(5);
  });

  it('counts none of the placeholders as known', () => {
    renderRail();
    const rows = screen.getAllByTestId('brief-skeleton-row');
    expect(rows.length).toBeGreaterThan(0);
    // The whole risk of a skeleton: rows on screen that the tally believes in.
    expect(screen.getByTestId('brief-tally').textContent).toContain(
      `0 of ${PROFILE_FIELD_REGISTRY.length} known`,
    );
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });

  it('hands over to the real modules as soon as one fact lands', () => {
    // Otherwise the skeleton would be a third list saying what the chip strip
    // and "Worth asking next" already say.
    renderRail([{ fieldId: 'partner_name', value: 'Coral' }]);
    expect(screen.queryByTestId('brief-skeleton')).not.toBeInTheDocument();
    expect(screen.getByTestId('brief-good-to-know')).toBeInTheDocument();
  });
});

describe('BriefRail — the who header', () => {
  it('shows her name and derives the age bucket from her birthday', () => {
    renderRail([
      { fieldId: 'partner_name', value: 'Coral' },
      { fieldId: 'birthday', value: '1990-06-17' },
    ]);
    expect(screen.getByText('Coral')).toBeInTheDocument();
    // The band depends on today's date, so assert the shape, not one word.
    expect(screen.getByTestId('brief-who').textContent).toMatch(
      /(early|mid|late)-(twenties|thirties|forties)/,
    );
  });

  it('renders her initial when there is no photo', () => {
    renderRail([{ fieldId: 'partner_name', value: 'Coral' }]);
    expect(screen.getByTestId('brief-cameo').textContent).toBe('C');
  });

  it('shows the shipped portrait for a partner the app has drawn', () => {
    renderRail([{ fieldId: 'partner_name', value: 'Samantha' }]);
    const image = screen.getByRole('img', { name: 'Illustrated portrait of Samantha' });
    expect(image).toHaveAttribute('src', '/samantha-portrait.svg');
  });

  it('names the cameo for what it does now: open her profile', () => {
    renderRail([{ fieldId: 'partner_name', value: 'Samantha' }]);
    // It used to open a file picker, which is not what a click on a face asks
    // for. Uploading a photo lives on the dossier's own avatar.
    expect(screen.getByTestId('brief-cameo')).toHaveAttribute(
      'aria-label',
      "Open Samantha's full profile",
    );
    expect(screen.queryByTestId('brief-photo-input')).not.toBeInTheDocument();
  });
});

describe('BriefRail — next up', () => {
  it('leads with the nearest occasion and its act-by deadline', () => {
    renderRail([
      { fieldId: 'partner_name', value: 'Coral' },
      { fieldId: 'anniversary', value: '2021-09-18' },
      { fieldId: 'birthday', value: '1990-06-17' },
    ]);
    expect(screen.getByTestId('brief-next-up-hero')).toBeInTheDocument();
    // The deadline is the headline — a countdown alone cannot tell you this.
    expect(screen.getByTestId('brief-act-by').textContent).toMatch(/(Book|Order|Plan) by \d/);
  });

  it('collapses every occasion after the first into a one-line row', () => {
    renderRail([
      { fieldId: 'partner_name', value: 'Coral' },
      { fieldId: 'anniversary', value: '2021-09-18' },
      { fieldId: 'birthday', value: '1990-06-17' },
      { fieldId: 'relationship_duration', value: '2019-03-02' },
    ]);
    // Three dates, one hero, two rows.
    expect(screen.getAllByTestId('brief-next-up-row')).toHaveLength(2);
  });

  it('says so plainly when no date is known yet', () => {
    renderRail([{ fieldId: 'partner_name', value: 'Coral' }]);
    expect(screen.getByTestId('brief-next-up-empty')).toBeInTheDocument();
  });
});

describe('BriefRail — keep in mind', () => {
  it('surfaces an allergy that resolves to no registry field', () => {
    // This is the slice of the deleted "Other Discoveries" group that could not
    // wait for Stage 6: a dinner suggestion ignoring it is worse than none.
    renderRail([{ fieldId: 'partner_name', value: 'Coral' }], [preference({})]);
    const caution = screen.getByTestId('brief-caution');
    expect(caution.textContent).toContain('shellfish');
    expect(caution.textContent).toContain('Check every menu');
  });

  it('warns when she prefers to choose her own gifts', () => {
    renderRail([
      { fieldId: 'partner_name', value: 'Coral' },
      { fieldId: 'surprise_preference', value: 'Prefers to Choose' },
    ]);
    expect(screen.getByTestId('brief-caution').textContent).toContain('Ask first');
  });

  it('renders nothing at all when there is nothing to warn about', () => {
    renderRail([
      { fieldId: 'partner_name', value: 'Coral' },
      { fieldId: 'surprise_preference', value: 'Loves Surprises' },
    ]);
    expect(screen.queryByTestId('brief-keep-in-mind')).not.toBeInTheDocument();
  });

  it('keys each caution stably, without depending on the server-assigned id', () => {
    // Caught by a browser console warning, not by a failing assertion: two
    // cautions from records with no `id` both keyed on undefined. The key comes
    // from category+key now, which also survives re-extraction reassigning ids.
    renderRail(
      [{ fieldId: 'partner_name', value: 'Coral' }],
      [
        preference({ id: '', key: 'allergies', value: 'shellfish' }),
        preference({ id: '', key: 'dislikes', value: 'aniseed' }),
      ],
    );
    expect(screen.getAllByTestId('brief-caution')).toHaveLength(2);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('does not mistake an ordinary preference for a constraint', () => {
    renderRail(
      [{ fieldId: 'partner_name', value: 'Coral' }],
      [preference({ key: 'favorite cuisine', value: 'Thai' })],
    );
    expect(screen.queryByTestId('brief-caution')).not.toBeInTheDocument();
  });
});

describe('BriefRail — the nudge', () => {
  it('asks for the highest-payoff gap, not the first registry field', () => {
    renderRail([{ fieldId: 'partner_name', value: 'Coral' }]);
    expect(screen.getByTestId('brief-nudge').textContent).toContain('love language');
  });

  it('moves to the next gap when the user says Later', () => {
    renderRail([{ fieldId: 'partner_name', value: 'Coral' }]);
    fireEvent.click(screen.getByTestId('brief-nudge-later'));
    const text = screen.getByTestId('brief-nudge').textContent ?? '';
    expect(text).not.toContain('love language');
    expect(text).toContain('anniversary');
  });

  it('hides once every field is known, rather than inventing filler', () => {
    renderRail(
      PROFILE_FIELD_REGISTRY.map((field) => ({
        fieldId: field.id,
        value: field.valueType === 'date' ? '2021-09-18' : 'known',
      })),
    );
    expect(screen.queryByTestId('brief-nudge')).not.toBeInTheDocument();
  });

  it('never repeats the gap the nudge already holds in Worth asking next', () => {
    renderRail([{ fieldId: 'partner_name', value: 'Coral' }]);
    const listed = screen.getAllByTestId('brief-gap').map((el) => el.getAttribute('data-field-id'));
    expect(listed).not.toContain('love_language');
  });
});

describe('BriefRail — good to know', () => {
  it('pins a chip for each short reference fact that is known', () => {
    renderRail([
      { fieldId: 'partner_name', value: 'Coral' },
      { fieldId: 'favorite_color', value: 'Deep sage green' },
    ]);
    const filled = screen
      .getAllByTestId('brief-chip')
      .filter((chip) => chip.getAttribute('data-empty') === 'false');
    expect(filled).toHaveLength(1);
    expect(filled[0].textContent).toContain('Deep sage green');
  });

  it('truncates a chip value too long for a pill', () => {
    renderRail([
      { fieldId: 'partner_name', value: 'Coral' },
      {
        fieldId: 'favorite_cuisine',
        value: 'Northern Italian — anything with brown butter and sage',
      },
    ]);
    const chip = screen
      .getAllByTestId('brief-chip')
      .find((el) => el.getAttribute('data-empty') === 'false');
    expect(chip?.textContent).toContain('…');
    expect((chip?.textContent ?? '').length).toBeLessThan(35);
  });

  it('shows empty chips as prompts, so the gaps are visible', () => {
    renderRail([
      { fieldId: 'partner_name', value: 'Coral' },
      { fieldId: 'favorite_color', value: 'Sage' },
    ]);
    const empties = screen
      .getAllByTestId('brief-chip')
      .filter((chip) => chip.getAttribute('data-empty') === 'true');
    expect(empties.length).toBeGreaterThan(0);
    expect(empties[0].textContent).toMatch(/^\+ /);
  });
});

describe('BriefRail — the tally footer', () => {
  it('counts what is known out of the whole registry', () => {
    renderRail([
      { fieldId: 'partner_name', value: 'Coral' },
      { fieldId: 'birthday', value: '1990-06-17' },
    ]);
    expect(screen.getByTestId('brief-tally').textContent).toContain(
      `2 of ${PROFILE_FIELD_REGISTRY.length} known`,
    );
  });

  it('exposes the tally as a progressbar for screen readers', () => {
    renderRail([{ fieldId: 'partner_name', value: 'Coral' }]);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '1');
    expect(bar).toHaveAttribute('aria-valuemax', String(PROFILE_FIELD_REGISTRY.length));
  });
});
