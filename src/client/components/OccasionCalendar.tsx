import { useState, useMemo } from 'react';
import type { Occasion } from '../utils/occasion-derivation';
import { occasionFallsOnDay, getNextOccasion, getDaysUntilOccasion } from '../utils/occasion-derivation';
import { colors, spacing, borderRadius, typography, animation } from '../design-system/tokens';

interface OccasionCalendarProps {
  occasions: Occasion[];
}

const calendarContainerStyle: React.CSSProperties = {
  padding: `${spacing.sm}px`,
  backgroundColor: colors.surface,
  borderRadius: borderRadius.lg,
  border: `1px solid ${colors.borderSubtle}`,
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: spacing.xs,
};

const monthLabelStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.sizes.sm,
  fontWeight: typography.weights.semibold,
  color: colors.text,
};

const navButtonStyle: React.CSSProperties = {
  background: 'none',
  border: `1px solid ${colors.border}`,
  borderRadius: borderRadius.sm,
  width: 28,
  height: 28,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  fontSize: typography.sizes.sm,
  color: colors.text,
  transition: `background-color ${animation.durations.fast}ms ${animation.easing.easeInOut}`,
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(7, 1fr)',
  gap: 2,
};

const weekdayHeaderStyle: React.CSSProperties = {
  fontSize: '0.625rem',
  fontWeight: typography.weights.medium,
  color: colors.textSecondary,
  textAlign: 'center',
  padding: '4px 0',
  textTransform: 'uppercase',
};

const dayCellStyle: React.CSSProperties = {
  fontSize: typography.sizes.xs,
  textAlign: 'center',
  padding: '4px 0',
  borderRadius: borderRadius.sm,
  cursor: 'default',
  minHeight: 28,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: `background-color ${animation.durations.fast}ms ${animation.easing.easeInOut}`,
};

const markedDayStyle: React.CSSProperties = {
  ...dayCellStyle,
  backgroundColor: colors.blush,
  color: colors.softBurgundy,
  fontWeight: typography.weights.semibold,
  cursor: 'pointer',
};

const selectedDayStyle: React.CSSProperties = {
  ...dayCellStyle,
  backgroundColor: colors.softBurgundy,
  color: colors.textOnAccent,
  fontWeight: typography.weights.bold,
};

const emptyDayStyle: React.CSSProperties = {
  ...dayCellStyle,
  color: 'transparent',
};

const nextOccasionStyle: React.CSSProperties = {
  marginTop: spacing.xs,
  padding: `${spacing.xs}px`,
  backgroundColor: colors.champagne,
  borderRadius: borderRadius.md,
  fontSize: typography.sizes.xs,
  color: colors.text,
};

const nextOccasionLabelStyle: React.CSSProperties = {
  fontWeight: typography.weights.semibold,
  color: colors.softBurgundy,
};

const tooltipStyle: React.CSSProperties = {
  marginTop: 4,
  padding: `4px ${spacing.xs}px`,
  backgroundColor: colors.deepPlum,
  color: colors.textOnAccent,
  borderRadius: borderRadius.sm,
  fontSize: typography.sizes.xs,
};

const emptyStateStyle: React.CSSProperties = {
  textAlign: 'center',
  padding: `${spacing.sm}px`,
  fontSize: typography.sizes.xs,
  color: colors.textSecondary,
  fontStyle: 'italic',
};

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function getMonthName(month: number): string {
  return new Date(2000, month, 1).toLocaleString('default', { month: 'long' });
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

export function OccasionCalendar({ occasions }: OccasionCalendarProps) {
  const today = new Date();
  const [displayYear, setDisplayYear] = useState(today.getFullYear());
  const [displayMonth, setDisplayMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  const daysInMonth = getDaysInMonth(displayYear, displayMonth);
  const firstDay = getFirstDayOfWeek(displayYear, displayMonth);

  const nextOccasion = useMemo(() => getNextOccasion(occasions, today), [occasions]);
  const daysUntilNext = nextOccasion ? getDaysUntilOccasion(nextOccasion, today) : null;

  const occasionsOnDay = useMemo(() => {
    if (selectedDay === null) return [];
    return occasions.filter((occ) => occasionFallsOnDay(occ, displayYear, displayMonth, selectedDay));
  }, [selectedDay, occasions, displayYear, displayMonth]);

  const handlePrevMonth = () => {
    if (displayMonth === 0) {
      setDisplayMonth(11);
      setDisplayYear(displayYear - 1);
    } else {
      setDisplayMonth(displayMonth - 1);
    }
    setSelectedDay(null);
  };

  const handleNextMonth = () => {
    if (displayMonth === 11) {
      setDisplayMonth(0);
      setDisplayYear(displayYear + 1);
    } else {
      setDisplayMonth(displayMonth + 1);
    }
    setSelectedDay(null);
  };

  const handleDayClick = (day: number, isMarked: boolean) => {
    if (isMarked) {
      setSelectedDay(selectedDay === day ? null : day);
    }
  };

  const handleDayKeyDown = (e: React.KeyboardEvent, day: number, isMarked: boolean) => {
    if ((e.key === 'Enter' || e.key === ' ') && isMarked) {
      e.preventDefault();
      handleDayClick(day, isMarked);
    }
  };

  const isEmpty = occasions.length === 0;

  // Build day cells
  const cells: React.ReactNode[] = [];

  // Empty cells before first day
  for (let i = 0; i < firstDay; i++) {
    cells.push(<div key={`empty-${i}`} style={emptyDayStyle} aria-hidden="true" />);
  }

  // Day cells
  for (let day = 1; day <= daysInMonth; day++) {
    const dayOccasions = occasions.filter((occ) => occasionFallsOnDay(occ, displayYear, displayMonth, day));
    const isMarked = dayOccasions.length > 0;
    const isSelected = selectedDay === day;

    let style = dayCellStyle;
    if (isSelected) style = selectedDayStyle;
    else if (isMarked) style = markedDayStyle;

    const ariaLabel = isMarked
      ? `${day} ${getMonthName(displayMonth)} - ${dayOccasions.map((o) => o.label).join(', ')}`
      : `${day} ${getMonthName(displayMonth)}`;

    cells.push(
      <div
        key={day}
        style={style}
        role="gridcell"
        tabIndex={isMarked ? 0 : -1}
        aria-label={ariaLabel}
        onClick={() => handleDayClick(day, isMarked)}
        onKeyDown={(e) => handleDayKeyDown(e, day, isMarked)}
        data-testid={`calendar-day-${day}`}
        data-marked={isMarked ? 'true' : undefined}
      >
        {day}
      </div>,
    );
  }

  return (
    <div style={calendarContainerStyle} data-testid="occasion-calendar">
      <div style={headerStyle}>
        <button
          style={navButtonStyle}
          onClick={handlePrevMonth}
          aria-label="Previous month"
          data-testid="calendar-prev"
        >
          {'<'}
        </button>
        <span style={monthLabelStyle}>{getMonthName(displayMonth)} {displayYear}</span>
        <button
          style={navButtonStyle}
          onClick={handleNextMonth}
          aria-label="Next month"
          data-testid="calendar-next"
        >
          {'>'}
        </button>
      </div>

      <div style={gridStyle} role="grid" aria-label={`Calendar for ${getMonthName(displayMonth)} ${displayYear}`}>
        {WEEKDAYS.map((wd) => (
          <div key={wd} style={weekdayHeaderStyle} role="columnheader">{wd}</div>
        ))}
        {cells}
      </div>

      {selectedDay !== null && occasionsOnDay.length > 0 && (
        <div style={tooltipStyle} role="status" data-testid="calendar-tooltip">
          {occasionsOnDay.map((occ) => occ.label).join(', ')}
        </div>
      )}

      {isEmpty ? (
        <p style={emptyStateStyle} data-testid="calendar-empty">
          No important dates known yet
        </p>
      ) : nextOccasion && daysUntilNext !== null ? (
        <div style={nextOccasionStyle} data-testid="next-occasion">
          <span style={nextOccasionLabelStyle}>Next: </span>
          {nextOccasion.label} — {daysUntilNext === 0 ? 'Today!' : `${daysUntilNext} day${daysUntilNext === 1 ? '' : 's'} away`}
        </div>
      ) : null}
    </div>
  );
}
