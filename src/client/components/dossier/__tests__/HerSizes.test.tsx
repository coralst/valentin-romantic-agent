import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HerSizes, splitSize } from '../HerSizes';
import type { ProfileFieldValue } from '../../../hooks/use-profile-store';

/** A `getFieldValue` over a plain map, shaped like the store's return value. */
function lookup(values: Record<string, string>) {
  return (fieldId: string): ProfileFieldValue | null =>
    fieldId in values
      ? { value: values[fieldId], source: 'manual', updatedAt: '2026-01-01T00:00:00.000Z' }
      : null;
}

const ALL = { bra_size: '34B', clothing_size: 'UK 10', shoulder_width: '38 cm' };

describe('HerSizes — what fits her', () => {
  it('shows the three measurements the tile is for, and only those', () => {
    render(<HerSizes getFieldValue={lookup(ALL)} onAsk={() => {}} />);

    expect(screen.getByTestId('dossier-her-sizes')).toHaveAttribute('data-known', '3');
    // Ring and shoe sizes are still extracted and still on file — they appear as
    // ordinary rows in "Everything I know". They are not what a glance is for.
    expect(screen.queryByTestId('dossier-size-ring_size')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dossier-size-shoe_size')).not.toBeInTheDocument();
  });

  it('sets the Hebrew row right-to-left but keeps it aligned with the English ones', () => {
    render(<HerSizes getFieldValue={lookup(ALL)} onAsk={() => {}} />);

    const row = screen.getByTestId('dossier-size-bra_size');
    const label = row.querySelector('[lang="he"]') as HTMLElement;
    // `dir` gets the two words in the right order; left alignment is what stops the
    // row mirroring the whole label/value pairing and reading backwards against the
    // two rows under it.
    expect(label).toHaveAttribute('dir', 'rtl');
    expect(label.textContent).toContain('מידת חזיה');
    expect(label.style.textAlign).toBe('left');
  });

  it('offers to ask rather than showing a dash for a measurement it does not have', async () => {
    const onAsk = vi.fn();
    render(<HerSizes getFieldValue={lookup({ clothing_size: 'UK 10' })} onAsk={onAsk} />);

    // A "—" in a figure slot reads as a rendering fault. An `Ask` pill is the one
    // thing that can actually change the state.
    expect(screen.getByTestId('dossier-size-bra_size')).toHaveAttribute('data-known', 'false');

    await userEvent.click(screen.getByTestId('dossier-size-ask-bra_size'));
    // In English, not Hebrew: the label is what *he* reads on the card, and asking
    // Valentin to raise "her מידת חזיה" would put it into an English sentence.
    expect(onAsk).toHaveBeenCalledWith('bra size');

    await userEvent.click(screen.getByTestId('dossier-size-ask-shoulder_width'));
    expect(onAsk).toHaveBeenLastCalledWith('shoulder measurement');
  });

  it('is read-only once every measurement is known', () => {
    render(<HerSizes getFieldValue={lookup(ALL)} onAsk={() => {}} />);
    // Editing lives in one place — `EverythingIKnow`'s `ProfileField`, which owns
    // validation and the clear path.
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('keeps the figure on one line and demotes the caveat written after it', () => {
    render(
      <HerSizes
        getFieldValue={lookup({ clothing_size: 'UK 10 / EU 38 — sizes up for knitwear' })}
        onAsk={() => {}}
      />,
    );

    // Nothing is dropped: the whole stored answer is still on the card. What moves
    // is which half is the figure, because the number is the part you read across a
    // shop and the caveat is the part you read when you get there.
    const row = screen.getByTestId('dossier-size-clothing_size');
    expect(row).toHaveTextContent('UK 10 / EU 38');
    expect(row).toHaveTextContent('sizes up for knitwear');
  });

  it('falls back to the row’s own qualifier when the value carries none', () => {
    render(<HerSizes getFieldValue={lookup(ALL)} onAsk={() => {}} />);
    expect(screen.getByTestId('dossier-size-shoulder_width')).toHaveTextContent(
      'For anything tailored',
    );
  });
});

describe('splitSize', () => {
  it('splits on each of the four ways people write the caveat', () => {
    expect(splitSize('UK 10 — sizes up for knits')).toEqual(['UK 10', 'sizes up for knits']);
    expect(splitSize('UK 6 (39 in most brands)')).toEqual(['UK 6', '39 in most brands']);
    expect(splitSize('L; maybe M in winter')).toEqual(['L', 'maybe M in winter']);
    expect(splitSize('L, maybe M in winter')).toEqual(['L', 'maybe M in winter']);
  });

  it('leaves a bare measurement whole', () => {
    // Including one with a slash in it: "UK 10 / EU 38" is one figure, not two.
    expect(splitSize('34B')).toEqual(['34B', null]);
    expect(splitSize('UK 10 / EU 38')).toEqual(['UK 10 / EU 38', null]);
  });
});
