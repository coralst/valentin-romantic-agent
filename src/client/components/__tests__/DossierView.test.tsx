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

  it('shows the zero-state copy for the cards a partial profile leaves empty', async () => {
    renderDossier([{ fieldId: 'partner_name', value: 'Samantha' }]);
    // "Also mentioned" lives on the Memories tab now, so reach it the way a user
    // would. It still has an empty state rather than vanishing, because its
    // absence would otherwise be indistinguishable from dropped extractions.
    await userEvent.click(screen.getByTestId('dossier-tab-memories'));
    expect(screen.getByTestId('dossier-also-mentioned-empty')).toBeInTheDocument();
    // "Confirm my guesses" and "Keep in mind" render nothing at all: a prompt
    // with no question in it, and a warning with nothing to warn about.
    await userEvent.click(screen.getByTestId('dossier-tab-overview'));
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

  it('filters the board by tab rather than showing everything at once', async () => {
    renderDossier([{ fieldId: 'partner_name', value: 'Samantha' }]);
    expect(screen.getByTestId('dossier-family-tree')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('dossier-tab-known'));
    expect(screen.getByTestId('dossier-tab-known')).toHaveAttribute('aria-selected', 'true');
    // Her people is a different tab, so its cards are gone — that is the point of
    // the overview staying short.
    expect(screen.queryByTestId('dossier-family-tree')).not.toBeInTheDocument();
    expect(screen.getByTestId('dossier-everything')).toBeInTheDocument();
  });
});
