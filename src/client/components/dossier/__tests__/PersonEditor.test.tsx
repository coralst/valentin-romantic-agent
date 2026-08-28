import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Person } from '../../../../shared/interfaces/person';
import { PersonEditor } from '../PersonEditor';

const LEAH: Person = {
  id: 'leah',
  name: 'Leah',
  relationship: 'Older sister',
  generation: 'peer',
  birthday: '1988-09-09',
  note: 'Goes by Lee',
  source: 'manual',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('PersonEditor', () => {
  it('saves an empty name as a gap rather than as a person called ""', async () => {
    // This is the whole point of the empty name: "she has a brother and I have
    // never caught his name" has to be recordable.
    const onSave = vi.fn();
    render(
      <PersonEditor person={null} generation="peer" onSave={onSave} onCancel={vi.fn()} />,
    );
    await userEvent.type(screen.getByTestId('person-relationship'), 'Brother');
    await userEvent.click(screen.getByTestId('person-save'));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: null, relationship: 'Brother', generation: 'peer' }),
    );
  });

  it('will not save without a relationship, which is the only required field', async () => {
    const onSave = vi.fn();
    render(
      <PersonEditor person={null} generation="peer" onSave={onSave} onCancel={vi.fn()} />,
    );
    await userEvent.type(screen.getByTestId('person-name'), 'Leah');
    expect(screen.getByTestId('person-save')).toBeDisabled();
    await userEvent.click(screen.getByTestId('person-save'));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('opens with the existing values and hands back the edited ones', async () => {
    const onSave = vi.fn();
    render(
      <PersonEditor person={LEAH} generation="peer" onSave={onSave} onCancel={vi.fn()} />,
    );
    expect(screen.getByTestId('person-name')).toHaveValue('Leah');
    expect(screen.getByTestId('person-birthday')).toHaveValue('1988-09-09');

    await userEvent.clear(screen.getByTestId('person-note'));
    await userEvent.type(screen.getByTestId('person-note'), 'Lives in Berlin');
    await userEvent.click(screen.getByTestId('person-save'));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Leah', note: 'Lives in Berlin' }),
    );
  });

  it('trims whitespace instead of storing a name of spaces', async () => {
    const onSave = vi.fn();
    render(
      <PersonEditor person={null} generation="elder" onSave={onSave} onCancel={vi.fn()} />,
    );
    await userEvent.type(screen.getByTestId('person-name'), '   ');
    await userEvent.type(screen.getByTestId('person-relationship'), '  Mother  ');
    await userEvent.click(screen.getByTestId('person-save'));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: null, relationship: 'Mother' }),
    );
  });

  it('lets a new person be put on a different row than the + that opened it', async () => {
    const onSave = vi.fn();
    render(
      <PersonEditor person={null} generation="peer" onSave={onSave} onCancel={vi.fn()} />,
    );
    await userEvent.type(screen.getByTestId('person-relationship'), 'Niece');
    await userEvent.selectOptions(screen.getByTestId('person-generation'), 'younger');
    await userEvent.click(screen.getByTestId('person-save'));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ generation: 'younger' }),
    );
  });

  it('puts the caret in the name field, since that is what the press was about', () => {
    render(
      <PersonEditor person={null} generation="peer" onSave={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByTestId('person-name')).toHaveFocus();
  });

  it('closes on Escape without letting the dossier behind it close too', async () => {
    // One Escape should close one thing.
    const onCancel = vi.fn();
    const outerEscape = vi.fn();
    document.addEventListener('keydown', outerEscape);
    try {
      render(
        <PersonEditor person={null} generation="peer" onSave={vi.fn()} onCancel={onCancel} />,
      );
      await userEvent.keyboard('{Escape}');
      expect(onCancel).toHaveBeenCalled();
      expect(outerEscape).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', outerEscape);
    }
  });

  it('offers Remove only when there is something to remove', () => {
    const { unmount } = render(
      <PersonEditor person={null} generation="peer" onSave={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.queryByTestId('person-remove')).not.toBeInTheDocument();
    unmount();

    render(
      <PersonEditor
        person={LEAH}
        generation="peer"
        onSave={vi.fn()}
        onCancel={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByTestId('person-remove')).toBeInTheDocument();
  });
});
