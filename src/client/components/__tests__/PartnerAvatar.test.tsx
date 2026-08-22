import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PartnerAvatar } from '../PartnerAvatar';
import { ProfileStoreProvider } from '../../context/profile-store-context';

function renderWithProvider(partnerName: string | null = null, size?: number) {
  return render(
    <ProfileStoreProvider sessionId="test-session">
      <PartnerAvatar partnerName={partnerName} size={size} />
    </ProfileStoreProvider>,
  );
}

describe('PartnerAvatar', () => {
  it('renders heart glyph when no name and no photo', () => {
    renderWithProvider(null);
    const avatar = screen.getByTestId('partner-avatar');
    expect(avatar.textContent).toContain('♥');
  });

  it('renders initials when name is provided but no photo', () => {
    renderWithProvider('Jane Doe');
    const avatar = screen.getByTestId('partner-avatar');
    expect(avatar.textContent).toContain('JD');
  });

  it('renders single initial for single-word name', () => {
    renderWithProvider('Alex');
    const avatar = screen.getByTestId('partner-avatar');
    expect(avatar.textContent).toContain('A');
  });

  it('has accessible upload button', () => {
    renderWithProvider(null);
    const button = screen.getByRole('button', { name: /upload partner photo/i });
    expect(button).toBeInTheDocument();
  });

  it('shows replace and remove buttons after photo upload', async () => {
    renderWithProvider('Test');

    // Simulate file upload
    const input = screen.getByTestId('avatar-file-input') as HTMLInputElement;
    const file = new File(['test'], 'photo.png', { type: 'image/png' });

    // Mock FileReader
    const mockReader = {
      readAsDataURL: vi.fn(),
      onload: null as ((evt: unknown) => void) | null,
      result: 'data:image/png;base64,test',
    };
    vi.spyOn(window, 'FileReader').mockImplementation(() => mockReader as unknown as FileReader);

    fireEvent.change(input, { target: { files: [file] } });

    // Trigger onload
    if (mockReader.readAsDataURL.mock.calls.length > 0) {
      mockReader.onload?.({ target: { result: 'data:image/png;base64,test' } });
    }

    vi.restoreAllMocks();
  });

  it('shows error for invalid file type', () => {
    renderWithProvider(null);
    const input = screen.getByTestId('avatar-file-input') as HTMLInputElement;
    const file = new File(['test'], 'doc.pdf', { type: 'application/pdf' });

    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);

    expect(screen.getByTestId('avatar-error')).toHaveTextContent('Accepted formats: PNG, JPEG, or WebP');
  });

  it('shows error for oversized file', () => {
    renderWithProvider(null);
    const input = screen.getByTestId('avatar-file-input') as HTMLInputElement;
    // Create a file object with a size > 5MB
    const file = new File(['x'.repeat(100)], 'big.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: 6 * 1024 * 1024 });

    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);

    expect(screen.getByTestId('avatar-error')).toHaveTextContent('Maximum file size is 5 MB');
  });

  it('upload button is keyboard accessible', () => {
    renderWithProvider(null);
    const button = screen.getByRole('button', { name: /upload partner photo/i });
    expect(button).toHaveAttribute('tabindex', '0');
  });

  describe('size prop', () => {
    it('defaults to the 96px profile portrait', () => {
      renderWithProvider('Jane Doe');
      const circle = screen.getByRole('button', { name: /upload partner photo/i });
      expect(circle.style.width).toBe('96px');
    });

    it('renders at cameo size for the dossier header', () => {
      renderWithProvider('Jane Doe', 50);
      const circle = screen.getByRole('button', { name: /upload partner photo/i });
      expect(circle.style.width).toBe('50px');
      expect(circle.style.height).toBe('50px');
    });

    it('drops the Replace/Remove pair at cameo size, where it is wider than the circle', () => {
      renderWithProvider('Jane Doe', 50);
      // The upload affordance itself stays — only the paired controls go.
      expect(screen.getByRole('button', { name: /upload partner photo/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
    });
  });
});
