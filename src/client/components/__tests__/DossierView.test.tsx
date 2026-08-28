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
import { useChatContext } from '../../context/chat-context';

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
      <ComposerProbe />
    </ViewProvider>
  );
}

/**
 * What the composer would be showing.
 *
 * The board fills the composer rather than sending — every ask on this surface
 * works that way — but `ChatPanel` is not mounted here, so the textarea it would
 * write into does not exist. This reads the same state the composer reads.
 */
function ComposerProbe() {
  const { state } = useChatContext();
  return <span data-testid="composer-probe">{state.inputValue}</span>;
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
 * Driven from a *partial* profile on purpose: with a fully seeded demo every card
 * is full and no empty state ever renders, so the only way to catch dead space and
 * invented data is to render the board against a profile that barely knows her.
 */
describe('DossierView — three bands', () => {
  it('reads top to bottom in three bands, widest thing last', () => {
    renderDossier([{ fieldId: 'partner_name', value: 'Samantha' }]);

    const bands = screen.getByTestId('dossier-bands');
    // The pair, then everything I know, then her family. Order is the design: the
    // tree is last because it is the only thing here with real structure, and a
    // tree drawn in a third of the measure is just an indented list.
    const order = ['dossier-band-pair', 'dossier-everything', 'dossier-family-tree'];
    const found = order.map((id) => screen.getByTestId(id));
    found.forEach((node) => expect(bands).toContainElement(node));
    expect(
      found.every((node, index) =>
        index === 0
          ? true
          : found[index - 1].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
  });

  it('has no progress meter anywhere on the surface', () => {
    // "21 of 21 known" was a score for the app rather than a fact about her, and it
    // was charged twice — once in this header, once in the rail's tally. Both gone.
    renderDossier([{ fieldId: 'partner_name', value: 'Samantha' }]);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dossier-stat-bar')).not.toBeInTheDocument();
    expect(screen.getByTestId('dossier-identity')).not.toHaveTextContent('How well I know her');
  });

  it('puts the four tiles inside "Everything I know", not in a band of their own', () => {
    renderDossier([{ fieldId: 'partner_name', value: 'Samantha' }]);
    const card = screen.getByTestId('dossier-everything');
    for (const tile of [
      'dossier-her-sizes',
      'dossier-her-palette',
      'dossier-gift-shortlist',
      'dossier-her-week',
    ]) {
      expect(card).toContainElement(screen.getByTestId(tile));
    }
  });

  it('draws four weeks of real days, and lights at most one of them', () => {
    renderDossier([
      { fieldId: 'partner_name', value: 'Samantha' },
      { fieldId: 'birthday', value: '1994-06-12' },
      { fieldId: 'anniversary', value: '2021-09-18' },
    ]);

    // 28 cells, every one of them a date: four weeks from this week's Monday, so
    // the grid never opens with a row of blanks to skip.
    expect(screen.getAllByTestId('four-week-cell')).toHaveLength(28);
    expect(screen.getAllByTestId('four-week-cell').filter((cell) => cell.dataset.today)).toHaveLength(1);
    // Two focal points in four weeks is none, so at most one cell is lit.
    expect(
      screen.getAllByTestId('four-week-cell').filter((cell) => cell.dataset.key).length,
    ).toBeLessThanOrEqual(1);
  });

  it('says nothing is dated rather than drawing an empty agenda', () => {
    renderDossier();
    expect(screen.getByTestId('dossier-four-weeks')).toHaveTextContent(
      /Nothing dated in the next four weeks/,
    );
    expect(screen.queryByTestId('four-week-agenda')).not.toBeInTheDocument();
  });

  it('offers to ask for the tiles it has no data for, rather than drawing empty ones', async () => {
    renderDossier([{ fieldId: 'partner_name', value: 'Samantha' }]);

    // The tiles are the mockup's, and they are all mounted — but a swatch strip
    // with invented colours in it would be the board asserting something nobody
    // said. Each one asks instead.
    expect(screen.getByTestId('dossier-her-palette')).toHaveAttribute('data-shades', '0');
    await userEvent.click(screen.getByTestId('palette-ask'));
    expect(screen.getByTestId('composer-probe').textContent).toContain('palette');
  });

  it('fills the tiles from the stored list fields', () => {
    renderDossier([
      { fieldId: 'color_palette', value: 'Deep sage, Linen, Oat, Blush' },
      { fieldId: 'gift_shortlist', value: 'Ceramic glaze set@62, Trail shoes@95' },
      { fieldId: 'gift_budget', value: 'Around £80 for everyday gestures' },
      { fieldId: 'weekly_rhythm', value: 'Tue@pottery until nine@heavy, Sun@bread baking@medium' },
    ]);

    expect(screen.getAllByTestId('palette-swatch')).toHaveLength(4);
    expect(screen.getByTestId('dossier-her-palette')).toHaveTextContent('Deep sage');

    expect(screen.getAllByTestId('shortlist-row')).toHaveLength(2);
    // Over budget is greyed, not hidden: he may still choose it.
    expect(
      screen.getAllByTestId('shortlist-row').filter((row) => row.dataset.over),
    ).toHaveLength(1);
    expect(screen.getByTestId('shortlist-budget')).toHaveTextContent('£62 / £80');

    // Seven columns whatever she does, two of them busy.
    expect(screen.getAllByTestId('her-week-column')).toHaveLength(7);
    expect(screen.getByTestId('dossier-her-week')).toHaveAttribute('data-days', '2');
    expect(screen.getByTestId('dossier-her-week')).toHaveTextContent('pottery until nine');
  });

  it('says the list is empty rather than pretending he has nothing to do', () => {
    // No tasks provider in this tree at all, which is the same as an empty list as
    // far as the card is concerned — and a correct empty state, not a crash.
    renderDossier([{ fieldId: 'partner_name', value: 'Samantha' }]);
    expect(screen.getByTestId('dossier-what-to-do')).toHaveTextContent('0 open');
    expect(screen.getByTestId('dossier-what-to-do')).toHaveTextContent(/Nothing on the list/);
  });

  it('keeps her family and her field list on one page at once', () => {
    // The inverse of the test this replaced, which asserted the thing the redesign
    // exists to undo: pressing a tab used to unmount the family tree.
    renderDossier([{ fieldId: 'partner_name', value: 'Samantha' }]);
    expect(screen.getByTestId('dossier-family-tree')).toBeInTheDocument();
    expect(screen.getByTestId('dossier-everything')).toBeInTheDocument();
  });

  it('drops "Also mentioned" entirely when nothing was left unmapped', () => {
    // It is not decoration — it rescues extraction output that resolves to no
    // registry field — but a heading over an empty state at the foot of the board
    // is a promise about content that is not there.
    renderDossier([{ fieldId: 'partner_name', value: 'Samantha' }]);
    expect(screen.queryByTestId('dossier-also-mentioned')).not.toBeInTheDocument();
  });

  it('names the top gaps when asked what is missing, rather than everything', async () => {
    renderDossier([{ fieldId: 'partner_name', value: 'Samantha' }]);
    await userEvent.click(screen.getByTestId('dossier-ask-all'));
    expect(screen.getByTestId('composer-probe').textContent).toMatch(
      /^Ask me about her .+, .+, .+\.$/,
    );
  });
});
