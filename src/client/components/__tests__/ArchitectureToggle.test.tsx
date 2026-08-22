import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ArchitectureToggle,
  ARCHITECTURE_TOGGLE_LABEL,
  ARCHITECTURE_TOGGLE_HIDE_HINT,
  ARCHITECTURE_TOGGLE_SHOW_HINT,
} from '../ArchitectureToggle';
import { LiveArchitectureDrawer } from '../LiveArchitectureDrawer';
import { ArchitectureDrawerProvider } from '../../context/architecture-drawer-context';

describe('ArchitectureToggle', () => {
  it('renders as a button with an explicit type', () => {
    render(<ArchitectureToggle />);
    expect(screen.getByTestId('architecture-toggle')).toHaveAttribute('type', 'button');
  });

  it('has a stable accessible name', () => {
    render(<ArchitectureToggle />);
    expect(
      screen.getByRole('button', { name: ARCHITECTURE_TOGGLE_LABEL }),
    ).toBeInTheDocument();
  });

  it('hints at what pressing it will do', () => {
    render(<ArchitectureToggle />);
    expect(screen.getByTestId('architecture-toggle')).toHaveAttribute(
      'title',
      ARCHITECTURE_TOGGLE_SHOW_HINT,
    );
  });

  it('reports its pressed state, so it reads as pressed on a projector', () => {
    render(<ArchitectureToggle />);
    expect(screen.getByTestId('architecture-toggle')).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows a text label when not compact', () => {
    render(<ArchitectureToggle />);
    expect(screen.getByText('Architecture')).toBeInTheDocument();
  });

  it('drops the text label when compact, for the collapsed rail', () => {
    render(<ArchitectureToggle compact />);
    expect(screen.queryByText('Architecture')).not.toBeInTheDocument();
    // The accessible name survives — the icon alone is not a name.
    expect(
      screen.getByRole('button', { name: ARCHITECTURE_TOGGLE_LABEL }),
    ).toBeInTheDocument();
  });

  /**
   * Several sidebar surfaces are rendered standalone in tests. A hard throw for a
   * missing provider would make the provider a hidden dependency of every one of
   * them, so the toggle degrades to inert instead.
   */
  it('renders inert without a provider rather than throwing', async () => {
    const user = userEvent.setup();
    render(<ArchitectureToggle />);

    await user.click(screen.getByTestId('architecture-toggle'));
    expect(screen.getByTestId('architecture-toggle')).toHaveAttribute('aria-pressed', 'false');
  });

  describe('with the drawer', () => {
    function renderWithDrawer() {
      return render(
        <ArchitectureDrawerProvider>
          <ArchitectureToggle />
          <LiveArchitectureDrawer />
        </ArchitectureDrawerProvider>,
      );
    }

    it('opens the drawer', async () => {
      const user = userEvent.setup();
      renderWithDrawer();

      await user.click(screen.getByTestId('architecture-toggle'));
      expect(screen.getByTestId('architecture-drawer')).toHaveAttribute('data-open', 'true');
    });

    it('reports pressed once open, and keeps its name', async () => {
      const user = userEvent.setup();
      renderWithDrawer();

      await user.click(screen.getByTestId('architecture-toggle'));

      const toggle = screen.getByTestId('architecture-toggle');
      expect(toggle).toHaveAttribute('aria-pressed', 'true');
      // The name must not become "Hide…": the drawer has its own Hide button, and
      // two buttons sharing one accessible name is ambiguous to anyone querying
      // by name — assistive tech and tests alike.
      expect(toggle).toHaveAccessibleName(ARCHITECTURE_TOGGLE_LABEL);
      expect(toggle).toHaveAttribute('title', ARCHITECTURE_TOGGLE_HIDE_HINT);
      // That name belongs to the drawer's own Hide control, and to it alone.
      expect(
        screen.getByRole('button', { name: ARCHITECTURE_TOGGLE_HIDE_HINT }),
      ).not.toBe(toggle);
    });

    it('closes the drawer when pressed again', async () => {
      const user = userEvent.setup();
      renderWithDrawer();

      await user.click(screen.getByTestId('architecture-toggle'));
      await user.click(screen.getByTestId('architecture-toggle'));

      expect(screen.getByTestId('architecture-drawer')).toHaveAttribute('data-open', 'false');
    });
  });
});
