import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmMyGuesses, deriveGuesses } from '../ConfirmMyGuesses';
import type { PreferenceWithHistory } from '../../../../shared/interfaces/preference';

function preference(overrides: Partial<PreferenceWithHistory> = {}): PreferenceWithHistory {
  return {
    id: 'pref-1',
    sessionId: 'session-1',
    category: 'personality_traits',
    key: 'nickname',
    value: 'Sam',
    confidence: 0.6,
    sourceMessageId: 'msg-1',
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:00:00.000Z',
    history: [],
    ...overrides,
  };
}

describe('deriveGuesses', () => {
  it('offers a low-confidence discovery as a settleable question', () => {
    const [guess] = deriveGuesses([preference()]);
    expect(guess.fieldId).toBe('nickname');
    expect(guess.question).toBe('Nickname: Sam?');
    expect(guess.value).toBe('Sam');
    expect(guess.confidence).toBe('likely');
  });

  it('leaves out anything Valentin is already confident about', () => {
    expect(deriveGuesses([preference({ confidence: 0.95 })])).toEqual([]);
  });

  it('leaves out fields the user has already answered by hand', () => {
    const guesses = deriveGuesses([preference()], [], (fieldId) => fieldId === 'nickname');
    expect(guesses).toEqual([]);
  });

  it('leaves out preferences that resolve to no field — ✓ would have nowhere to promote to', () => {
    // `food` spans several registry fields, so the mapper will not guess a
    // default for an unrecognized key in it. A single-field category like
    // `hobbies` would resolve anything and make this assertion vacuous.
    const guesses = deriveGuesses([preference({ category: 'food', key: 'texture' })]);
    expect(guesses).toEqual([]);
  });

  it('keys guesses on category+key, which survives re-extraction', () => {
    const [guess] = deriveGuesses([preference({ id: 'a-server-id-that-will-change' })]);
    expect(guess.id).toBe('personality_traits:nickname');
  });

  it('leaves out fields the user has already rejected', () => {
    // Otherwise ✗ is a no-op on screen: the preference is still in the store, so
    // the question re-derives on the very next render. Screenshot-found.
    const guesses = deriveGuesses([preference()], [], undefined, (fieldId) => fieldId === 'nickname');
    expect(guesses).toEqual([]);
  });

  it('carries a provenance line rather than invented reasoning', () => {
    // The mockup's `.why` ("I inferred this because she surfs…") has no backing
    // field anywhere. This states when he picked the value up, which is true.
    const [guess] = deriveGuesses([preference()]);
    expect(guess.provenance).toBe('I noted this on 11 Aug from something you said.');
    expect(guess.provenance).not.toMatch(/inferred|because/i);
  });
});

describe('ConfirmMyGuesses', () => {
  const guess = {
    id: 'personality_traits:nickname',
    fieldId: 'nickname',
    question: 'Nickname: Sam?',
    value: 'Sam',
    confidence: 'likely',
    provenance: 'I noted this on 11 Aug from something you said.',
  };

  it('renders nothing when there is no question to ask', () => {
    const { container } = render(
      <ConfirmMyGuesses guesses={[]} onConfirm={vi.fn()} onReject={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('offers ✓ and ✗ per guess', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onReject = vi.fn();
    render(
      <ConfirmMyGuesses guesses={[guess]} onConfirm={onConfirm} onReject={onReject} />,
    );

    await user.click(screen.getByTestId('dossier-guess-confirm'));
    expect(onConfirm).toHaveBeenCalledWith(guess);

    await user.click(screen.getByTestId('dossier-guess-reject'));
    expect(onReject).toHaveBeenCalledWith(guess);
  });

  it('omits the provenance line rather than showing a wrong date', () => {
    render(
      <ConfirmMyGuesses
        guesses={[{ ...guess, provenance: null }]}
        onConfirm={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.queryByText(/noted this on/)).not.toBeInTheDocument();
    expect(screen.getByText(/Nickname: Sam\?/)).toBeInTheDocument();
  });
});
