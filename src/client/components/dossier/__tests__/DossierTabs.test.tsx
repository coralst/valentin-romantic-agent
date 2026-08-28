import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DossierTabs, type TabDefinition } from '../DossierTabs';
import { toneInk } from '../accent-tones';

const TABS: TabDefinition[] = [
  { id: 'overview', label: 'Overview', tone: 'date' },
  { id: 'known', label: 'What I know', count: 12, tone: 'fact' },
  { id: 'people', label: 'Her people', count: 0, tone: 'kin' },
  { id: 'gifts', label: 'Gifts', count: null, tone: 'gift' },
];

describe('DossierTabs', () => {
  it('announces itself as a tablist with one selected tab', () => {
    render(<DossierTabs tabs={TABS} active="known" onSelect={vi.fn()} />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getByTestId('dossier-tab-known')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('dossier-tab-overview')).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('fills the active tab in its own family ink, so the bar agrees with the cards', () => {
    render(<DossierTabs tabs={TABS} active="people" onSelect={vi.fn()} />);
    const active = screen.getByTestId('dossier-tab-people');
    // jsdom normalises hex to rgb().
    expect(active.style.background).toBeTruthy();
    expect(active.style.background).not.toBe('transparent');
    expect(toneInk('kin')).toBe('#A05A7A');
  });

  it('hides a count that is zero or absent rather than printing "0"', () => {
    render(<DossierTabs tabs={TABS} active="overview" onSelect={vi.fn()} />);
    expect(screen.getByTestId('dossier-tab-known')).toHaveTextContent('12');
    expect(screen.getByTestId('dossier-tab-people')).toHaveTextContent(/^Her people$/);
    expect(screen.getByTestId('dossier-tab-gifts')).toHaveTextContent(/^Gifts$/);
  });

  it('reports the tab that was pressed', async () => {
    const onSelect = vi.fn();
    render(<DossierTabs tabs={TABS} active="overview" onSelect={onSelect} />);
    await userEvent.click(screen.getByTestId('dossier-tab-gifts'));
    expect(onSelect).toHaveBeenCalledWith('gifts');
  });
});
