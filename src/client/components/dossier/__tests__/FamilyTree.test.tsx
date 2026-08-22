import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Person } from '../../../../shared/interfaces/person';
import { FamilyTree } from '../FamilyTree';

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: 'leah',
    name: 'Leah',
    relationship: 'Older sister',
    generation: 'peer',
    birthday: null,
    note: null,
    source: 'manual',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const NOW = new Date('2026-08-22T09:00:00');

function renderTree(people: Person[], overrides: Partial<Parameters<typeof FamilyTree>[0]> = {}) {
  const props = {
    people,
    partnerName: 'Samantha',
    onSelectPerson: vi.fn(),
    onAddPerson: vi.fn(),
    onAskAboutGap: vi.fn(),
    now: NOW,
    ...overrides,
  };
  render(<FamilyTree {...props} />);
  return props;
}

describe('FamilyTree', () => {
  it('draws her on the middle row even though she is not a record', () => {
    // The tree is hers. Leaving her out makes it a diagram of a family she is
    // not in.
    renderTree([person({ id: 'miriam', name: 'Miriam', generation: 'elder' })]);
    const her = screen.getByTestId('family-node-her');
    expect(her).toHaveTextContent('Samantha');
    expect(screen.getByTestId('family-row-peer')).toContainElement(her);
  });

  it('still shows the peer row when only she is on it', () => {
    renderTree([person({ id: 'miriam', name: 'Miriam', generation: 'elder' })]);
    expect(screen.getByTestId('family-row-peer')).toBeInTheDocument();
    // Nothing younger has been recorded, so that row is not drawn empty.
    expect(screen.queryByTestId('family-row-younger')).not.toBeInTheDocument();
  });

  it('falls back to "Her" when the name is not known yet', () => {
    renderTree([person()], { partnerName: null });
    expect(screen.getByTestId('family-node-her')).toHaveTextContent('Her');
  });

  it('asks about a gap instead of opening it for editing', async () => {
    // A gap has nothing to edit — what it has is a question.
    const gap = person({ id: 'g1', name: null, relationship: 'Brother' });
    const props = renderTree([gap]);
    const node = screen.getByTestId('family-node-g1');
    expect(node).toHaveAttribute('data-gap', 'true');
    expect(node).toHaveTextContent('Brother?');

    await userEvent.click(node);
    expect(props.onAskAboutGap).toHaveBeenCalledWith(gap);
    expect(props.onSelectPerson).not.toHaveBeenCalled();
  });

  it('opens a named person for editing', async () => {
    const leah = person();
    const props = renderTree([leah]);
    await userEvent.click(screen.getByTestId('family-node-leah'));
    expect(props.onSelectPerson).toHaveBeenCalledWith(leah);
    expect(props.onAskAboutGap).not.toHaveBeenCalled();
  });

  it('adds to the row the + belongs to', async () => {
    const props = renderTree([person({ id: 'miriam', generation: 'elder', name: 'Miriam' })]);
    await userEvent.click(screen.getByTestId('family-add-elder'));
    expect(props.onAddPerson).toHaveBeenCalledWith('elder');
  });

  it('counts named people and gaps separately in the header', () => {
    renderTree([
      person(),
      person({ id: 'g1', name: null, relationship: 'Brother' }),
      person({ id: 'g2', name: null, relationship: 'Best friend' }),
    ]);
    expect(screen.getByTestId('dossier-family-tree')).toHaveTextContent('1 named · 2 gaps');
  });

  it('says "gap" in the singular', () => {
    renderTree([person({ id: 'g1', name: null, relationship: 'Brother' })]);
    expect(screen.getByTestId('dossier-family-tree')).toHaveTextContent('0 named · 1 gap');
  });

  it('adds a countdown to the date chip only once it is close', () => {
    renderTree([
      person({ id: 'soon', name: 'Leah', birthday: '1988-09-09' }),
      person({ id: 'far', name: 'Miriam', generation: 'elder', birthday: '1962-02-04' }),
    ]);
    // `Sep` or `Sept` depending on the runner's ICU — the assertion is about the
    // countdown, not about which abbreviation the platform ships.
    expect(screen.getByTestId('family-node-soon')).toHaveTextContent(/9 Sept? · 18d/);
    // 166 days away: a countdown there is noise, so only the day shows.
    expect(screen.getByTestId('family-node-far')).toHaveTextContent('4 Feb');
    expect(screen.getByTestId('family-node-far')).not.toHaveTextContent('166d');
  });

  it('offers a first person rather than an empty card', async () => {
    const props = renderTree([]);
    expect(screen.queryByTestId('family-node-her')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('family-tree-add-first'));
    expect(props.onAddPerson).toHaveBeenCalledWith('peer');
  });
});
