import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProfileField } from '../ProfileField';
import type { ProfileFieldDefinition } from '../../utils/profile-field-registry';
import type { ProfileFieldValue } from '../../hooks/use-profile-store';

const textField: ProfileFieldDefinition = {
  id: 'partner_name',
  label: 'Name',
  valueType: 'text',
  section: 'basics',
  mappings: [{ category: 'personality_traits', key: 'name' }],
};

const dateField: ProfileFieldDefinition = {
  id: 'birthday',
  label: 'Birthday',
  valueType: 'date',
  section: 'basics',
  mappings: [{ category: 'important_dates', key: 'birthday' }],
};

const enumField: ProfileFieldDefinition = {
  id: 'love_language',
  label: 'Love Language',
  valueType: 'enum',
  section: 'relationship',
  enumOptions: ['Words of Affirmation', 'Acts of Service', 'Receiving Gifts', 'Quality Time', 'Physical Touch'],
  mappings: [{ category: 'love_language', key: 'primary' }],
};

describe('ProfileField', () => {
  const defaultProps = {
    definition: textField,
    value: null as ProfileFieldValue | null,
    onSave: vi.fn(),
    onClear: vi.fn(),
  };

  it('shows placeholder when no value', () => {
    render(<ProfileField {...defaultProps} />);
    expect(screen.getByText('Not yet known')).toBeInTheDocument();
  });

  it('shows the field label', () => {
    render(<ProfileField {...defaultProps} />);
    expect(screen.getByText('Name')).toBeInTheDocument();
  });

  it('shows Add button when no value', () => {
    render(<ProfileField {...defaultProps} />);
    expect(screen.getByTestId('edit-btn-partner_name')).toHaveTextContent('Add');
  });

  it('shows Edit button when value exists', () => {
    const value: ProfileFieldValue = { value: 'Alex', source: 'manual', updatedAt: new Date().toISOString() };
    render(<ProfileField {...defaultProps} value={value} />);
    expect(screen.getByTestId('edit-btn-partner_name')).toHaveTextContent('Edit');
  });

  it('displays discovered value with confidence badge', () => {
    const value: ProfileFieldValue = { value: 'Alex', source: 'discovered', confidence: 0.85, updatedAt: new Date().toISOString() };
    render(<ProfileField {...defaultProps} value={value} />);
    expect(screen.getByText('Alex')).toBeInTheDocument();
    expect(screen.getByText('85%')).toBeInTheDocument();
  });

  it('displays manual value with manual badge', () => {
    const value: ProfileFieldValue = { value: 'Alex', source: 'manual', updatedAt: new Date().toISOString() };
    render(<ProfileField {...defaultProps} value={value} />);
    expect(screen.getByText('Alex')).toBeInTheDocument();
    expect(screen.getByText('manual')).toBeInTheDocument();
  });

  it('marks tentative when confidence < 0.5', () => {
    const value: ProfileFieldValue = { value: 'Maybe', source: 'discovered', confidence: 0.3, updatedAt: new Date().toISOString() };
    render(<ProfileField {...defaultProps} value={value} />);
    expect(screen.getByText('tentative')).toBeInTheDocument();
  });

  it('does not mark tentative when confidence >= 0.5', () => {
    const value: ProfileFieldValue = { value: 'Sure', source: 'discovered', confidence: 0.7, updatedAt: new Date().toISOString() };
    render(<ProfileField {...defaultProps} value={value} />);
    expect(screen.queryByText('tentative')).not.toBeInTheDocument();
  });

  it('enters edit mode on edit button click', () => {
    render(<ProfileField {...defaultProps} />);
    fireEvent.click(screen.getByTestId('edit-btn-partner_name'));
    expect(screen.getByTestId('input-partner_name')).toBeInTheDocument();
  });

  it('calls onSave with valid value', () => {
    const onSave = vi.fn();
    render(<ProfileField {...defaultProps} onSave={onSave} />);

    fireEvent.click(screen.getByTestId('edit-btn-partner_name'));
    const input = screen.getByTestId('input-partner_name');
    fireEvent.change(input, { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith('Alex');
  });

  it('shows validation error for empty value', () => {
    render(<ProfileField {...defaultProps} />);
    fireEvent.click(screen.getByTestId('edit-btn-partner_name'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByTestId('field-validation-error')).toHaveTextContent('Value cannot be empty');
  });

  it('validates date format with empty submission', () => {
    render(<ProfileField {...defaultProps} definition={dateField} />);
    fireEvent.click(screen.getByTestId('edit-btn-birthday'));
    // Submit without entering anything - should show validation error
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByTestId('field-validation-error')).toBeInTheDocument();
  });

  it('accepts valid date format', () => {
    const onSave = vi.fn();
    render(<ProfileField {...defaultProps} definition={dateField} onSave={onSave} />);
    fireEvent.click(screen.getByTestId('edit-btn-birthday'));
    const input = screen.getByTestId('input-birthday') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1990-06-15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith('1990-06-15');
  });

  it('cancels edit mode without saving', () => {
    const onSave = vi.fn();
    render(<ProfileField {...defaultProps} onSave={onSave} />);

    fireEvent.click(screen.getByTestId('edit-btn-partner_name'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByTestId('input-partner_name')).not.toBeInTheDocument();
  });

  it('renders enum as select input', () => {
    render(<ProfileField {...defaultProps} definition={enumField} value={null} />);
    fireEvent.click(screen.getByTestId('edit-btn-love_language'));
    const select = screen.getByTestId('input-love_language');
    expect(select.tagName.toLowerCase()).toBe('select');
  });

  it('edit button has accessible label', () => {
    render(<ProfileField {...defaultProps} />);
    const btn = screen.getByTestId('edit-btn-partner_name');
    expect(btn).toHaveAttribute('aria-label', 'Edit Name');
  });
});
