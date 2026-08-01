import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OccasionCalendar } from '../OccasionCalendar';
import type { Occasion } from '../../utils/occasion-derivation';

const birthdayOccasion: Occasion = {
  fieldId: 'birthday',
  label: 'Birthday',
  date: new Date(1990, 5, 15), // June 15
  recurrence: 'annual',
};

const anniversaryOccasion: Occasion = {
  fieldId: 'anniversary',
  label: 'Anniversary',
  date: new Date(2015, 8, 20), // September 20
  recurrence: 'annual',
};

describe('OccasionCalendar', () => {
  it('renders the current month by default', () => {
    render(<OccasionCalendar occasions={[]} />);
    const today = new Date();
    const monthName = today.toLocaleString('default', { month: 'long' });
    expect(screen.getByText(new RegExp(monthName))).toBeInTheDocument();
  });

  it('shows empty state when no occasions', () => {
    render(<OccasionCalendar occasions={[]} />);
    expect(screen.getByTestId('calendar-empty')).toHaveTextContent('No important dates known yet');
  });

  it('renders weekday headers', () => {
    render(<OccasionCalendar occasions={[]} />);
    expect(screen.getByText('Su')).toBeInTheDocument();
    expect(screen.getByText('Mo')).toBeInTheDocument();
    expect(screen.getByText('Fr')).toBeInTheDocument();
    expect(screen.getByText('Sa')).toBeInTheDocument();
  });

  it('renders day cells for the month', () => {
    render(<OccasionCalendar occasions={[]} />);
    // Every month has at least days 1-28
    expect(screen.getByTestId('calendar-day-1')).toBeInTheDocument();
    expect(screen.getByTestId('calendar-day-15')).toBeInTheDocument();
    expect(screen.getByTestId('calendar-day-28')).toBeInTheDocument();
  });

  it('marks days with occasions', () => {
    // Render June specifically
    const { container } = render(<OccasionCalendar occasions={[birthdayOccasion]} />);

    // Navigate to June to test marking
    const today = new Date();
    const monthsToJune = (5 - today.getMonth() + 12) % 12;

    for (let i = 0; i < monthsToJune; i++) {
      fireEvent.click(screen.getByTestId('calendar-next'));
    }

    // Day 15 should be marked
    const day15 = screen.getByTestId('calendar-day-15');
    expect(day15).toHaveAttribute('data-marked', 'true');
  });

  it('navigates to next month', () => {
    render(<OccasionCalendar occasions={[]} />);
    const today = new Date();
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const nextMonthName = nextMonth.toLocaleString('default', { month: 'long' });

    fireEvent.click(screen.getByTestId('calendar-next'));
    expect(screen.getByText(new RegExp(nextMonthName))).toBeInTheDocument();
  });

  it('navigates to previous month', () => {
    render(<OccasionCalendar occasions={[]} />);
    const today = new Date();
    const prevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const prevMonthName = prevMonth.toLocaleString('default', { month: 'long' });

    fireEvent.click(screen.getByTestId('calendar-prev'));
    expect(screen.getByText(new RegExp(prevMonthName))).toBeInTheDocument();
  });

  it('shows tooltip on marked day click', () => {
    render(<OccasionCalendar occasions={[birthdayOccasion]} />);

    // Navigate to June
    const today = new Date();
    const monthsToJune = (5 - today.getMonth() + 12) % 12;
    for (let i = 0; i < monthsToJune; i++) {
      fireEvent.click(screen.getByTestId('calendar-next'));
    }

    const day15 = screen.getByTestId('calendar-day-15');
    fireEvent.click(day15);
    expect(screen.getByTestId('calendar-tooltip')).toHaveTextContent('Birthday');
  });

  it('shows next upcoming occasion', () => {
    // Use an occasion that is definitely in the future
    const futureDate = new Date();
    futureDate.setMonth(futureDate.getMonth() + 2);
    const futureOccasion: Occasion = {
      fieldId: 'future_event',
      label: 'Future Event',
      date: futureDate,
      recurrence: 'annual',
    };

    render(<OccasionCalendar occasions={[futureOccasion]} />);
    const nextOccasionEl = screen.getByTestId('next-occasion');
    expect(nextOccasionEl).toHaveTextContent('Future Event');
    expect(nextOccasionEl).toHaveTextContent(/day/);
  });

  it('navigation buttons are keyboard accessible', () => {
    render(<OccasionCalendar occasions={[]} />);
    const prevBtn = screen.getByTestId('calendar-prev');
    const nextBtn = screen.getByTestId('calendar-next');
    expect(prevBtn).toHaveAttribute('aria-label', 'Previous month');
    expect(nextBtn).toHaveAttribute('aria-label', 'Next month');
  });

  it('grid has accessible role', () => {
    render(<OccasionCalendar occasions={[]} />);
    const grid = screen.getByRole('grid');
    expect(grid).toBeInTheDocument();
  });

  it('marked days have accessible labels', () => {
    render(<OccasionCalendar occasions={[birthdayOccasion]} />);

    // Navigate to June
    const today = new Date();
    const monthsToJune = (5 - today.getMonth() + 12) % 12;
    for (let i = 0; i < monthsToJune; i++) {
      fireEvent.click(screen.getByTestId('calendar-next'));
    }

    const day15 = screen.getByTestId('calendar-day-15');
    expect(day15).toHaveAttribute('aria-label', expect.stringContaining('Birthday'));
  });

  it('marked days are focusable via tab', () => {
    render(<OccasionCalendar occasions={[birthdayOccasion]} />);

    // Navigate to June
    const today = new Date();
    const monthsToJune = (5 - today.getMonth() + 12) % 12;
    for (let i = 0; i < monthsToJune; i++) {
      fireEvent.click(screen.getByTestId('calendar-next'));
    }

    const day15 = screen.getByTestId('calendar-day-15');
    expect(day15).toHaveAttribute('tabindex', '0');
  });

  it('unmarked days are not focusable', () => {
    render(<OccasionCalendar occasions={[birthdayOccasion]} />);

    // Navigate to June
    const today = new Date();
    const monthsToJune = (5 - today.getMonth() + 12) % 12;
    for (let i = 0; i < monthsToJune; i++) {
      fireEvent.click(screen.getByTestId('calendar-next'));
    }

    // Day 14 should not be marked
    const day14 = screen.getByTestId('calendar-day-14');
    expect(day14).toHaveAttribute('tabindex', '-1');
  });
});
