import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useLayoutEffect, useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DossierView } from '../DossierView';
import { ChatProvider } from '../../context/chat-context';
import { PreferencesProvider } from '../../context/preferences-context';
import {
  ProfileStoreProvider,
  useProfileStoreContext,
} from '../../context/profile-store-context';
import { ViewProvider, useViewState } from '../../context/view-context';

vi.mock('../../context/websocket-context', () => ({
  useWebSocketContext: () => ({
    sendMessage: () => {},
    connectionStatus: 'connected' as const,
    lastError: null,
  }),
}));

/**
 * Writes seed fields into the real store, then renders the dossier against them.
 *
 * A layout effect rather than an inline dispatch: dispatching during render warns
 * about updating a provider from inside another component's render pass, and the
 * gate keeps the dossier from ever observing the pre-seed store.
 */
function Seeder({ fields }: { fields: Array<{ fieldId: string; value: string }> }) {
  const { dispatch } = useProfileStoreContext();
  const view = useViewState();
  const [seeded, setSeeded] = useState(fields.length === 0);

  useLayoutEffect(() => {
    for (const field of fields) {
      dispatch({ type: 'SET_MANUAL_VALUE', fieldId: field.fieldId, value: field.value });
    }
    setSeeded(true);
  }, [fields, dispatch]);

  if (!seeded) return null;
  return (
    <ViewProvider value={view}>
      <DossierView />
    </ViewProvider>
  );
}

function renderDossier(fields: Array<{ fieldId: string; value: string }> = []) {
  return render(
    <ChatProvider>
      <PreferencesProvider>
        <ProfileStoreProvider sessionId={null}>
          <Seeder fields={fields} />
        </ProfileStoreProvider>
      </PreferencesProvider>
    </ChatProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

/*
 * The board's own layout, rather than the routing around it.
 *
 * Both of these came out of the partial-profile screenshots: with an 18/18 demo
 * profile every card is full and the empty states never render, so the only way
 * to catch dead space in a zero-state is to drive a partial profile.
 */
describe('DossierView board layout', () => {
  it('narrows "What’s coming" to a third while it is empty', () => {
    // A grid row is as tall as its tallest member however the items align inside
    // it, so a one-line empty state spanning two-thirds of the row leaves a void
    // beside the short cards. Empty, it takes a third like everything else.
    renderDossier();
    expect(screen.getByTestId('dossier-whats-coming-empty')).toBeInTheDocument();
    expect(screen.getByTestId('dossier-whats-coming-slot').style.gridColumn).toBe('span 4');
  });

  it('takes the width back once there are dates to lay out on the spine', () => {
    renderDossier([{ fieldId: 'birthday', value: '1994-06-12' }]);
    expect(screen.queryByTestId('dossier-whats-coming-empty')).not.toBeInTheDocument();
    // Two-thirds of twelve: the spine is the hero figure of the overview, and it
    // needs the room to read as one.
    expect(screen.getByTestId('dossier-whats-coming-slot').style.gridColumn).toBe('span 8');
  });

  it('shows the zero-state copy for the cards a partial profile leaves empty', () => {
    renderDossier([{ fieldId: 'partner_name', value: 'Samantha' }]);
    // No clicking to get here any more: every section is mounted, so the empty
    // state is simply on the page. It still renders rather than vanishing, because
    // its absence would be indistinguishable from dropped extractions.
    expect(screen.getByTestId('dossier-also-mentioned-empty')).toBeInTheDocument();
    // "Confirm my guesses" and "Keep in mind" render nothing at all: a prompt
    // with no question in it, and a warning with nothing to warn about.
    expect(screen.queryByTestId('dossier-guesses')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dossier-keep-in-mind')).not.toBeInTheDocument();
  });

  it('leads with figures about the relationship, not only about the form', () => {
    // The old header's only number was "5 of 21". How long you have been together
    // and how soon the next occasion is were nowhere on the page.
    renderDossier([
      { fieldId: 'anniversary', value: '2020-06-12' },
      { fieldId: 'birthday', value: '1994-06-12' },
    ]);
    const bar = screen.getByTestId('dossier-stat-bar');
    expect(bar).toHaveTextContent('Days together');
    expect(bar).toHaveTextContent('Next occasion');
    expect(bar).toHaveTextContent('How well I know her');
  });

  it('shows no figure at all rather than a placeholder for one it cannot compute', () => {
    // A "—" in a 22px slot reads as a rendering fault, and "about five years?"
    // would defeat the point of a number whose value is that it is exact.
    renderDossier();
    const bar = screen.getByTestId('dossier-stat-bar');
    expect(bar).not.toHaveTextContent('Days together');
    // Nobody has been added, so "Her people" is not a figure yet either.
    expect(bar).not.toHaveTextContent('Her people');
    expect(bar).toHaveTextContent('How well I know her');
  });

  /*
   * The replacement for the old "filters the board by tab" test, inverted.
   *
   * That test asserted the thing the redesign exists to undo: clicking `Everything
   * I know` used to unmount the family tree. Now nothing unmounts, so what is worth
   * pinning is that the tree, the field list and her sizes are all on one page at
   * once — the pair of facts the panel is most often opened for.
   */
  it('shows every section at once rather than filtering the board', () => {
    renderDossier([{ fieldId: 'partner_name', value: 'Samantha' }]);
    expect(screen.getByTestId('dossier-family-tree')).toBeInTheDocument();
    expect(screen.getByTestId('dossier-everything')).toBeInTheDocument();
    expect(screen.getByTestId('dossier-her-sizes')).toBeInTheDocument();
    expect(screen.getByTestId('dossier-their-birthdays')).toBeInTheDocument();
  });

  it('gives the rail one entry per heading actually on the board, and no more', () => {
    renderDossier([{ fieldId: 'partner_name', value: 'Samantha' }]);

    const railIds = screen
      .getAllByTestId(/^dossier-section-link-/)
      .map((entry) => entry.dataset.testid?.replace('dossier-section-link-', ''));
    const headingIds = screen
      .getAllByTestId('dossier-section-head')
      .map((head) => head.dataset.sectionId);

    // Same set, same order. A rail entry whose heading is missing scrolls nowhere,
    // and a heading with no entry is unreachable from the rail — both are the same
    // bug, and this is the assertion that catches either.
    expect(railIds).toEqual(headingIds);

    // Nothing has been guessed from an empty chat, so `Confirm my guesses` is not
    // one of them: `ConfirmMyGuesses` returns null with no guesses, which would
    // leave its heading standing over an empty row.
    expect(railIds).not.toContain('confirm');
    expect(railIds).toContain('sizes');
  });

  it('jumps to a section instead of hiding the others when the rail is pressed', async () => {
    renderDossier([{ fieldId: 'partner_name', value: 'Samantha' }]);

    // jsdom performs no layout, so `scrollIntoView` is not implemented — the point
    // being asserted is that the rail *navigates*: it calls scroll, marks itself
    // current, and leaves every card mounted.
    const heading = screen
      .getAllByTestId('dossier-section-head')
      .find((head) => head.dataset.sectionId === 'file');
    const scrollIntoView = vi.fn();
    heading!.scrollIntoView = scrollIntoView;

    await userEvent.click(screen.getByTestId('dossier-section-link-file'));

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(screen.getByTestId('dossier-section-link-file')).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByTestId('dossier-family-tree')).toBeInTheDocument();
  });
});
