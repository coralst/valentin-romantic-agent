import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppWindow, windowCellStyle } from '../AppWindow';
import { layout, radii, insets } from '../../design-system/tokens';

describe('AppWindow', () => {
  it('lays the desktop frame out as the four mocked columns', () => {
    render(
      <AppWindow variant="desktop">
        <div />
      </AppWindow>,
    );
    const frame = screen.getByTestId('app-window');
    expect(frame.style.gridTemplateColumns).toBe(
      `${layout.iconRailWidth}px ${layout.conversationListWidth}px minmax(0, 1fr) ${layout.briefRailWidth}px`,
    );
  });

  it('floats the desktop window on an inset linen page with a 34px radius', () => {
    render(
      <AppWindow variant="desktop">
        <div />
      </AppWindow>,
    );
    expect(screen.getByTestId('app-window-page').style.padding).toBe(`${insets.tight}px`);
    expect(screen.getByTestId('app-window').style.borderRadius).toBe(`${radii.window}px`);
    expect(screen.getByTestId('app-window').style.overflow).toBe('hidden');
  });

  it('goes full-bleed on mobile so the frame does not eat a 375px viewport', () => {
    render(
      <AppWindow variant="mobile">
        <div />
      </AppWindow>,
    );
    // jsdom serialises a unitless zero as "0", not "0px".
    expect(screen.getByTestId('app-window-page').style.padding).toBe('0px');
    const frame = screen.getByTestId('app-window');
    expect(frame.style.borderRadius).toBe('0');
    expect(frame.style.boxShadow).toBe('none');
    // Stacked rows, not columns: the rail becomes a top strip.
    expect(frame.style.gridTemplateColumns).toBe('100%');
  });

  it('zeroes the min sizes on window cells so the composer cannot be pushed out', () => {
    // Regression guard for option-5d-brief.html:41-42. A grid item defaults to
    // min-height:auto, which sizes it to its content — the chat column would
    // then grow to fit the whole transcript and push the composer out of the
    // window rather than scrolling.
    expect(windowCellStyle.minHeight).toBe(0);
    expect(windowCellStyle.minWidth).toBe(0);
  });
});
