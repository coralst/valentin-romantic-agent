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
  it('draws her on her own band even though she is not a record', () => {
    // The tree is hers. Leaving her out makes it a diagram of a family she is
    // not in.
    renderTree([person({ id: 'miriam', name: 'Miriam', generation: 'elder' })]);
    const her = screen.getByTestId('family-node-her');
    expect(her).toHaveTextContent('Samantha');
    expect(screen.getByTestId('family-band-peer')).toContainElement(her);
  });

  it('draws four generation bands, grandparents included', async () => {
    // Four rather than three: grandparents are a real rung of a family, and
    // folding Miriam in with Ruth and Daniel says she is their sibling.
    const props = renderTree([person({ id: 'miriam', name: 'Miriam', generation: 'grandparent' })]);
    for (const band of ['grandparent', 'elder', 'peer', 'younger']) {
      expect(screen.getByTestId(`family-band-${band}`)).toBeInTheDocument();
    }

    // Found by driving the real page: skipping empty bands left no way to add a
    // first younger person once anyone else existed.
    await userEvent.click(screen.getByTestId('family-add-younger'));
    expect(props.onAddPerson).toHaveBeenCalledWith('younger');
  });

  it('keeps a generation on one line by fixing the node width', () => {
    // 134px is the width at which her own generation — six people — fits on one
    // line in the board's measure. A seventh card orphaned onto a second row reads
    // as a descendant, which is a claim about her family the app cannot make.
    renderTree([person()]);
    expect((screen.getByTestId('family-node-leah') as HTMLElement).style.width).toBe('134px');
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
    expect(node).toHaveTextContent('Unnamed');
    expect(node).toHaveTextContent('Brother');
    // The question, as a button, on the card that is missing the answer.
    expect(node).toHaveTextContent('Ask her');

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

  it('adds to the band the + belongs to', async () => {
    const props = renderTree([person({ id: 'miriam', generation: 'elder', name: 'Miriam' })]);
    await userEvent.click(screen.getByTestId('family-add-elder'));
    expect(props.onAddPerson).toHaveBeenCalledWith('elder');
  });

  it('counts everyone it holds, and says how many are still unnamed', () => {
    renderTree([
      person(),
      person({ id: 'g1', name: null, relationship: 'Brother' }),
      person({ id: 'g2', name: null, relationship: 'Best friend' }),
    ]);
    // The count is of people, not of names: someone mentioned but unnamed is still
    // somebody in her family, and the second half of the line is what is missing.
    expect(screen.getByTestId('dossier-family-tree')).toHaveTextContent('3 known · 2 still unnamed');
  });

  it('drops the unnamed clause when there is nothing missing', () => {
    renderTree([person()]);
    const card = screen.getByTestId('dossier-family-tree');
    expect(card).toHaveTextContent('1 known');
    expect(card).not.toHaveTextContent('unnamed');
  });

  it('adds a date to her own card when her birthday is known', () => {
    renderTree([person()], { partnerBirthday: '1994-06-12' });
    expect(screen.getByTestId('family-node-her')).toHaveTextContent(/12 Jun/);
  });

  it('leaves her card dateless rather than dashed when it is not', () => {
    renderTree([person()]);
    expect(screen.getByTestId('family-node-her')).not.toHaveTextContent('—');
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
