import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fc from 'fast-check';
import { LearnedChip } from '../LearnedChip';

describe('LearnedChip', () => {
  it('renders the eyebrow, the value and the confidence word', () => {
    render(<LearnedChip value="Uses she/her" confidence={1} onDismiss={() => {}} />);

    const chip = screen.getByTestId('learned-chip');
    expect(chip.textContent).toContain('Noted');
    expect(chip.textContent).toContain('Uses she/her');
    expect(chip.textContent).toContain('certain');
  });

  it('renders the confidence as a word, never as a raw number', () => {
    render(<LearnedChip value="Salsa dancing" confidence={0.62} onDismiss={() => {}} />);

    const chip = screen.getByTestId('learned-chip');
    expect(chip.textContent).toContain('likely');
    // A leaked 0.62 / 62% would be the bug this guards.
    expect(chip.textContent).not.toMatch(/\d/);
  });

  it('calls onDismiss when the ✕ is pressed', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<LearnedChip value="Uses she/her" confidence={1} onDismiss={onDismiss} />);

    await user.click(screen.getByRole('button', { name: 'Dismiss Uses she/her' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('names the dismiss button after the discovery it clears', () => {
    // Several chips can be on screen at once, so a bare "Dismiss" would be
    // ambiguous to anyone navigating by button name.
    render(
      <>
        <LearnedChip value="Uses she/her" confidence={1} onDismiss={() => {}} />
        <LearnedChip value="Allergic to shellfish" confidence={1} onDismiss={() => {}} />
      </>,
    );

    expect(screen.getByRole('button', { name: 'Dismiss Uses she/her' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Dismiss Allergic to shellfish' }),
    ).toBeInTheDocument();
  });

  it('always reports one of the three confidence words for any score', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (confidence) => {
        const { unmount } = render(
          <LearnedChip value="v" confidence={confidence} onDismiss={() => {}} />,
        );
        const word = screen.getByTestId('learned-chip').getAttribute('data-confidence');
        unmount();
        expect(['certain', 'likely', 'maybe']).toContain(word);
      }),
      { numRuns: 100 },
    );
  });
});
