import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import fc from 'fast-check';
import { TypingIndicator } from '../TypingIndicator';

describe('TypingIndicator', () => {
  /**
   * Property 3: Typing indicator reflects agent processing state
   * For any ChatState where isTyping is true, indicator is visible. Where false, not visible.
   * **Validates: Requirements 1.4**
   */
  it('is visible when isVisible=true and hidden when isVisible=false (Property 3)', () => {
    fc.assert(
      fc.property(fc.boolean(), (isVisible) => {
        const { unmount } = render(<TypingIndicator isVisible={isVisible} />);
        const indicator = screen.queryByTestId('typing-indicator');

        if (isVisible) {
          expect(indicator).toBeInTheDocument();
        } else {
          expect(indicator).not.toBeInTheDocument();
        }

        unmount();
      }),
      { numRuns: 100 },
    );
  });

  it('returns null when not visible', () => {
    const { container } = render(<TypingIndicator isVisible={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders three animated dots when visible', () => {
    render(<TypingIndicator isVisible={true} />);
    const indicator = screen.getByTestId('typing-indicator');
    const dots = indicator.querySelectorAll('span');
    expect(dots.length).toBe(3);
  });
});
