import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useLayoutEffect, useState } from 'react';
import { render, screen } from '@testing-library/react';
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
  it('drops the two-column span while "What’s coming" is empty', () => {
    // A grid row is as tall as its tallest member however the items align inside
    // it, so a one-line empty state spanning two columns leaves a void beside the
    // short cards. Empty, it takes one column like everything else.
    renderDossier();
    expect(screen.getByTestId('dossier-whats-coming-empty')).toBeInTheDocument();
    expect(screen.getByTestId('dossier-whats-coming-slot').style.gridColumn).toBe('');
  });

  it('takes the span back once there are dates to lay out on the spine', () => {
    renderDossier([{ fieldId: 'birthday', value: '1994-06-12' }]);
    expect(screen.queryByTestId('dossier-whats-coming-empty')).not.toBeInTheDocument();
    expect(screen.getByTestId('dossier-whats-coming-slot').style.gridColumn).toBe('span 2');
  });

  it('shows the zero-state copy for the cards a partial profile leaves empty', () => {
    renderDossier([{ fieldId: 'partner_name', value: 'Mirabel' }]);
    // "Also mentioned" has an empty state rather than vanishing, because its
    // absence would otherwise be indistinguishable from dropped extractions.
    expect(screen.getByTestId('dossier-also-mentioned-empty')).toBeInTheDocument();
    // "Confirm my guesses" and "Keep in mind" render nothing at all: a prompt
    // with no question in it, and a warning with nothing to warn about.
    expect(screen.queryByTestId('dossier-guesses')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dossier-keep-in-mind')).not.toBeInTheDocument();
  });
});
