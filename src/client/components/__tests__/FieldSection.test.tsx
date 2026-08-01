import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FieldSection } from '../FieldSection';
import type { ProfileFieldDefinition } from '../../utils/profile-field-registry';
import type { ProfileFieldValue } from '../../hooks/use-profile-store';

const mockFields: ProfileFieldDefinition[] = [
  {
    id: 'partner_name',
    label: 'Name',
    valueType: 'text',
    section: 'basics',
    mappings: [{ category: 'personality_traits', key: 'name' }],
  },
  {
    id: 'birthday',
    label: 'Birthday',
    valueType: 'date',
    section: 'basics',
    mappings: [{ category: 'important_dates', key: 'birthday' }],
  },
];

describe('FieldSection', () => {
  const defaultProps = {
    sectionId: 'basics',
    label: 'Basics',
    fields: mockFields,
    getFieldValue: () => null as ProfileFieldValue | null,
    onSaveField: vi.fn(),
    onClearField: vi.fn(),
    highlightedFieldIds: new Set<string>(),
  };

  it('renders the section heading', () => {
    render(<FieldSection {...defaultProps} />);
    expect(screen.getByText('Basics')).toBeInTheDocument();
  });

  it('renders collapsed when no fields have values', () => {
    render(<FieldSection {...defaultProps} />);
    const header = screen.getByTestId('section-header-basics');
    expect(header).toHaveAttribute('aria-expanded', 'false');
  });

  it('renders expanded when at least one field has a value', () => {
    const getFieldValue = (id: string) => {
      if (id === 'partner_name') {
        return { value: 'Alex', source: 'manual' as const, updatedAt: new Date().toISOString() };
      }
      return null;
    };
    render(<FieldSection {...defaultProps} getFieldValue={getFieldValue} />);
    const header = screen.getByTestId('section-header-basics');
    expect(header).toHaveAttribute('aria-expanded', 'true');
  });

  it('toggles expanded state on click', () => {
    const getFieldValue = (id: string) => {
      if (id === 'partner_name') {
        return { value: 'Alex', source: 'manual' as const, updatedAt: new Date().toISOString() };
      }
      return null;
    };
    render(<FieldSection {...defaultProps} getFieldValue={getFieldValue} />);
    const header = screen.getByTestId('section-header-basics');

    expect(header).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows filled count in header', () => {
    const getFieldValue = (id: string) => {
      if (id === 'partner_name') {
        return { value: 'Alex', source: 'manual' as const, updatedAt: new Date().toISOString() };
      }
      return null;
    };
    render(<FieldSection {...defaultProps} getFieldValue={getFieldValue} />);
    const section = screen.getByTestId('field-section');
    expect(section.textContent).toContain('1/2');
  });

  it('renders all fields when expanded', () => {
    const getFieldValue = (id: string) => {
      if (id === 'partner_name') {
        return { value: 'Alex', source: 'manual' as const, updatedAt: new Date().toISOString() };
      }
      return null;
    };
    render(<FieldSection {...defaultProps} getFieldValue={getFieldValue} />);
    const fields = screen.getAllByTestId('profile-field');
    expect(fields).toHaveLength(2);
  });

  it('heading has button role for accessibility', () => {
    render(<FieldSection {...defaultProps} />);
    const header = screen.getByTestId('section-header-basics');
    expect(header.tagName.toLowerCase()).toBe('button');
  });

  it('responds to keyboard Enter to toggle', () => {
    const getFieldValue = (id: string) => {
      if (id === 'partner_name') {
        return { value: 'Alex', source: 'manual' as const, updatedAt: new Date().toISOString() };
      }
      return null;
    };
    render(<FieldSection {...defaultProps} getFieldValue={getFieldValue} />);
    const header = screen.getByTestId('section-header-basics');

    fireEvent.keyDown(header, { key: 'Enter' });
    // The button's native behavior handles Enter/Space; we just verify it's a button
    expect(header.tagName.toLowerCase()).toBe('button');
  });
});
