import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PreferenceWithHistory } from '../../../../shared/interfaces/preference';
import { derivePartnerSummary } from '../../../utils/partner-summary';
import { PartnerSummary } from '../PartnerSummary';

function lookup(values: Record<string, string>) {
  return (fieldId: string) =>
    values[fieldId] === undefined ? null : { value: values[fieldId] };
}

function allergy(): PreferenceWithHistory {
  return {
    id: 'pref-1',
    sessionId: 'session-1',
    category: 'food',
    key: 'shellfish_allergy',
    value: 'badly allergic to shellfish',
    confidence: 0.95,
    sourceMessageId: 'msg-1',
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    history: [],
  };
}

/** Render through the real derivation, so the card and the util cannot drift. */
function renderSummary({
  values = {},
  preferences = [],
  name = 'Maya',
  onAsk = () => {},
}: {
  values?: Record<string, string>;
  preferences?: PreferenceWithHistory[];
  name?: string | null;
  onAsk?: () => void;
} = {}) {
  const summary = derivePartnerSummary(lookup(values), preferences, name);
  return render(<PartnerSummary summary={summary} name={name} onAsk={onAsk} />);
}

describe('PartnerSummary', () => {
  it('asks to be told about her rather than showing a blank paragraph', () => {
    renderSummary({ name: 'Maya' });

    expect(screen.getByTestId('summary-empty').textContent).toContain('Maya');
    expect(screen.queryByTestId('summary-paragraph')).not.toBeInTheDocument();
  });

  it('reads as prose once there is something to say', () => {
    renderSummary({
      values: { home_city: 'Tel Aviv', favorite_cuisine: 'Mediterranean' },
    });

    const paragraph = screen.getByTestId('summary-paragraph').textContent ?? '';
    expect(paragraph).toContain('Maya lives in Tel Aviv.');
    expect(paragraph).toContain('She loves mediterranean.');
  });

  it('draws an allergy in the warning tone, not as another grey chip', () => {
    renderSummary({ values: { favorite_cuisine: 'Mediterranean' }, preferences: [allergy()] });

    const tags = screen.getAllByTestId(/^summary-tag-/);
    const tones = tags.map((tag) => tag.dataset.tone);
    expect(tones[0]).toBe('constraint');
    expect(tones).toContain('taste');
  });

  it('never elides the word that says what to avoid', () => {
    renderSummary({ preferences: [allergy()] });

    expect(screen.getByText('Badly allergic to shellfish')).toBeInTheDocument();
  });

  it('renders no chip strip when nothing is known', () => {
    renderSummary();

    expect(screen.queryByTestId('summary-tags')).not.toBeInTheDocument();
  });

  it('hands the ask back to the caller, which puts it in the composer', async () => {
    const onAsk = vi.fn();
    renderSummary({ onAsk });

    await userEvent.click(screen.getByTestId('summary-ask'));

    expect(onAsk).toHaveBeenCalledOnce();
  });
});
