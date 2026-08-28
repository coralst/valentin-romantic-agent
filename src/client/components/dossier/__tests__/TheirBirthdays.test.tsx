import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Person } from '../../../../shared/interfaces/person';
import { TheirBirthdays } from '../TheirBirthdays';

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: 'leah',
    name: 'Leah',
    relationship: 'Older sister',
    generation: 'peer',
    birthday: '1988-09-09',
    note: null,
    source: 'manual',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const NOW = new Date('2026-08-22T09:00:00');

describe('TheirBirthdays', () => {
  it('lists soonest first and headlines how far off the next one is', () => {
    render(
      <TheirBirthdays
        people={[
          person({ id: 'miriam', name: 'Miriam', birthday: '1962-02-04' }),
          person(),
        ]}
        onSelectPerson={vi.fn()}
        now={NOW}
      />,
    );
    const rows = screen.getAllByTestId(/^birthday-row-/);
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual([
      'birthday-row-leah',
      'birthday-row-miriam',
    ]);
    expect(screen.getByTestId('dossier-their-birthdays')).toHaveTextContent('next 18d');
  });

  it('says today and tomorrow in words', () => {
    render(
      <TheirBirthdays
        people={[
          person({ id: 'today', name: 'Noa', birthday: '2019-08-22' }),
          person({ id: 'tomorrow', name: 'David', birthday: '1960-08-23' }),
        ]}
        onSelectPerson={vi.fn()}
        now={NOW}
      />,
    );
    expect(screen.getByTestId('birthday-row-today')).toHaveTextContent('today');
    expect(screen.getByTestId('birthday-row-tomorrow')).toHaveTextContent('tomorrow');
  });

  it('shows the day in the row without shifting it a day west of Greenwich', () => {
    render(<TheirBirthdays people={[person()]} onSelectPerson={vi.fn()} now={NOW} />);
    expect(screen.getByTestId('birthday-row-leah')).toHaveTextContent(
      /Older sister · 9 Sept?/,
    );
  });

  it('caps the list and says how many are left rather than hiding them silently', () => {
    const people = ['09-09', '10-01', '11-02', '12-03', '01-04', '02-05', '03-06'].map(
      (md, index) => person({ id: `p${index}`, name: `P${index}`, birthday: `1990-${md}` }),
    );
    render(
      <TheirBirthdays people={people} onSelectPerson={vi.fn()} now={NOW} limit={5} />,
    );
    expect(screen.getAllByTestId(/^birthday-row-/)).toHaveLength(5);
    expect(screen.getByTestId('dossier-their-birthdays')).toHaveTextContent(
      'and 2 more, further out',
    );
  });

  it('leaves out anyone with no birthday instead of guessing one', () => {
    render(
      <TheirBirthdays
        people={[person(), person({ id: 'undated', name: 'Ben', birthday: null })]}
        onSelectPerson={vi.fn()}
        now={NOW}
      />,
    );
    expect(screen.queryByTestId('birthday-row-undated')).not.toBeInTheDocument();
  });

  it('opens a person from their row', async () => {
    const onSelectPerson = vi.fn();
    const leah = person();
    render(<TheirBirthdays people={[leah]} onSelectPerson={onSelectPerson} now={NOW} />);
    await userEvent.click(screen.getByTestId('birthday-row-leah'));
    expect(onSelectPerson).toHaveBeenCalledWith(leah);
  });

  it('explains why the card is worth filling when it is empty', () => {
    render(<TheirBirthdays people={[]} onSelectPerson={vi.fn()} now={NOW} />);
    expect(screen.getByTestId('dossier-their-birthdays')).toHaveTextContent(
      /No birthdays yet/,
    );
    expect(screen.queryByTestId(/^birthday-row-/)).not.toBeInTheDocument();
  });
});
