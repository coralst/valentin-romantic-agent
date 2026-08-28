import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HerSizes } from '../HerSizes';
import type { ProfileFieldValue } from '../../../hooks/use-profile-store';

/** A `getFieldValue` over a plain map, shaped like the store's return value. */
function lookup(values: Record<string, string>) {
  return (fieldId: string): ProfileFieldValue | null =>
    fieldId in values
      ? { value: values[fieldId], source: 'manual', updatedAt: '2026-01-01T00:00:00.000Z' }
      : null;
}

describe('HerSizes', () => {
  it('shows the three sizes in shop order rather than registry order', () => {
    render(
      <HerSizes
        getFieldValue={lookup({ clothing_size: 'M', shoe_size: '39', ring_size: 'L' })}
        onAsk={() => {}}
      />,
    );

    const card = screen.getByTestId('dossier-her-sizes');
    expect(card).toHaveAttribute('data-known', '3');
    // Clothes, shoes, ring — the order you would be asked for them at a counter.
    const labels = ['Clothes', 'Shoes', 'Ring'];
    const rendered = ['clothing_size', 'shoe_size', 'ring_size'].map(
      (fieldId) => screen.getByTestId(`dossier-size-${fieldId}`).textContent,
    );
    rendered.forEach((text, index) => expect(text).toContain(labels[index]));
  });

  it('offers to ask rather than showing a dash for a size it does not have', async () => {
    const onAsk = vi.fn();
    render(<HerSizes getFieldValue={lookup({ shoe_size: '39' })} onAsk={onAsk} />);

    // A "—" in a 34px slot reads as a rendering fault. An `Ask` pill is the one
    // thing that can actually change the state.
    expect(screen.getByTestId('dossier-size-clothing_size')).toHaveAttribute(
      'data-known',
      'false',
    );
    await userEvent.click(screen.getByTestId('dossier-size-ask-clothing_size'));
    expect(onAsk).toHaveBeenCalledWith('clothes size');

    await userEvent.click(screen.getByTestId('dossier-size-ask-ring_size'));
    // Not "ring size size" — the label is the noun, so the ring case is special.
    expect(onAsk).toHaveBeenLastCalledWith('ring size');
  });

  it('is read-only: no size can be edited from here', () => {
    render(
      <HerSizes
        getFieldValue={lookup({ clothing_size: 'M', shoe_size: '39', ring_size: 'L' })}
        onAsk={() => {}}
      />,
    );
    // Editing lives in one place — `EverythingIKnow`'s `ProfileField`, which owns
    // validation and the clear path. A second editable surface for the same three
    // fields would be a second thing to keep correct.
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('keeps the figure large and demotes the caveat people write after it', () => {
    render(
      <HerSizes
        getFieldValue={lookup({
          clothing_size: 'UK 10 / EU 38 — sizes up for knitwear',
          shoe_size: 'UK 6 (39 in most brands)',
          ring_size: 'L, maybe M in winter',
        })}
        onAsk={() => {}}
      />,
    );

    // Nothing is dropped: the whole stored answer is still on the card. What moves
    // is which half is set at 34px, because the number is the part you read across
    // a shop and the caveat is the part you read when you get there.
    const clothes = screen.getByTestId('dossier-size-clothing_size');
    expect(clothes.querySelector('span:nth-child(2)')!.textContent).toBe('UK 10 / EU 38');
    expect(clothes).toHaveTextContent('sizes up for knitwear');

    // A bracket and a comma are the other two ways the caveat gets written.
    expect(
      screen.getByTestId('dossier-size-shoe_size').querySelector('span:nth-child(2)')!.textContent,
    ).toBe('UK 6');
    expect(screen.getByTestId('dossier-size-shoe_size')).toHaveTextContent('39 in most brands');
    expect(
      screen.getByTestId('dossier-size-ring_size').querySelector('span:nth-child(2)')!.textContent,
    ).toBe('L');
  });

  it('steps a long answer down so the card does not outgrow its neighbours', () => {
    render(
      <HerSizes
        getFieldValue={lookup({ clothing_size: 'UK 10 / EU 38', shoe_size: '39' })}
        onAsk={() => {}}
      />,
    );

    const long = screen.getByTestId('dossier-size-clothing_size').querySelector('span:nth-child(2)');
    const short = screen.getByTestId('dossier-size-shoe_size').querySelector('span:nth-child(2)');
    // 34px would wrap "UK 10 / EU 38" onto three lines in a ~90px cell and push the
    // whole card taller than the two beside it.
    expect((long as HTMLElement).style.fontSize).toBe('19px');
    expect((short as HTMLElement).style.fontSize).toBe('34px');
  });
});
