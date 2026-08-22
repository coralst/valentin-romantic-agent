import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EverythingIKnow } from '../EverythingIKnow';
import { PROFILE_FIELD_REGISTRY } from '../../../utils/profile-field-registry';
import type { ProfileFieldValue } from '../../../hooks/use-profile-store';

function manual(value: string): ProfileFieldValue {
  return { value, source: 'manual', updatedAt: '2026-08-20T00:00:00.000Z' };
}

function renderCard(
  values: Record<string, ProfileFieldValue> = {},
  overrides: Partial<React.ComponentProps<typeof EverythingIKnow>> = {},
) {
  const props = {
    getFieldValue: (fieldId: string) => values[fieldId] ?? null,
    onSaveField: vi.fn(),
    onClearField: vi.fn(),
    ...overrides,
  };
  render(<EverythingIKnow {...props} />);
  return props;
}

describe('EverythingIKnow', () => {
  it('uses CSS multi-column so five sections fill three columns', () => {
    // A 3-column *grid* tiles five sections as 3 + 2 and leaves the sixth cell
    // dead. Multi-column balances by content height instead of item count.
    renderCard();
    const columns = screen.getByTestId('dossier-everything-columns');
    expect(columns.style.columns).toBe('3');
    expect(columns.style.columnFill).toBe('balance');
  });

  it('collapses to a single column on mobile', () => {
    renderCard({}, { isMobile: true });
    expect(screen.getByTestId('dossier-everything-columns').style.columns).toBe('1');
  });

  it('renders every registry field, expanded, with no collapse control', () => {
    renderCard();
    expect(screen.getAllByTestId('dossier-field')).toHaveLength(PROFILE_FIELD_REGISTRY.length);
    expect(screen.getAllByTestId('dossier-field-section')).toHaveLength(5);
  });

  it('avoids breaking a section heading away from its fields', () => {
    renderCard();
    for (const section of screen.getAllByTestId('dossier-field-section')) {
      expect(section.style.breakInside).toBe('avoid');
    }
  });

  it('keeps ProfileField’s inline edit for known values', async () => {
    const user = userEvent.setup();
    const props = renderCard({ partner_name: manual('Mirabel') });

    const row = screen
      .getAllByTestId('dossier-field')
      .find((node) => node.getAttribute('data-field-id') === 'partner_name');
    expect(row).toHaveAttribute('data-known', 'true');
    expect(row?.querySelector('[data-testid="profile-field"]')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Edit Name' }));
    const input = screen.getByTestId('input-partner_name');
    await user.clear(input);
    await user.type(input, 'Mira{Enter}');
    expect(props.onSaveField).toHaveBeenCalledWith('partner_name', 'Mira');
  });

  it('turns an unknown field into an Ask prompt rather than an empty row', async () => {
    const user = userEvent.setup();
    const onAsk = vi.fn();
    renderCard({}, { onAsk });

    const row = screen
      .getAllByTestId('dossier-field')
      .find((node) => node.getAttribute('data-field-id') === 'love_language');
    expect(row).toHaveAttribute('data-known', 'false');

    await user.click(screen.getByRole('button', { name: 'Ask about her love language' }));
    expect(onAsk).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'love_language' }),
    );
  });

  it('counts what is known overall and per section', () => {
    renderCard({ partner_name: manual('Mirabel'), nickname: manual('Mira') });
    expect(screen.getByText(`2 of ${PROFILE_FIELD_REGISTRY.length}`)).toBeInTheDocument();
    // Basics holds four fields, two of which are now filled.
    expect(screen.getByText('2 of 4')).toBeInTheDocument();
  });
});
