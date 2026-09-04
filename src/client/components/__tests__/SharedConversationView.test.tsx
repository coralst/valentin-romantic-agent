import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SharedConversationView } from '../SharedConversationView';
import type { SharedConversation } from '../../../shared/constants/share-link';

/**
 * The guest surface.
 *
 * Two assertions here are about what must *not* happen. No `Authorization` header:
 * the share token in the path is the whole credential, and a stale bearer token left
 * in the browser from an earlier signed-in visit must not turn this into a request
 * the server answers as that user. And nothing to type into: a composer or a link
 * into the dossier on a read-only page is a promise this view cannot keep.
 */

const conversation: SharedConversation = {
  title: 'Planning the 4th',
  messages: [
    {
      role: 'user',
      content: 'She mentioned she likes the small place near the port.',
      timestamp: '2026-09-01T18:00:00.000Z',
    },
    {
      role: 'assistant',
      content: 'Noted. I will look for a table there on Saturday.',
      timestamp: '2026-09-01T18:00:04.000Z',
    },
  ],
  expiresAt: '2026-09-10T09:00:00.000Z',
};

/** A `fetch` that never settles, so the loading state can be observed. */
function fetchThatHangs(): void {
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
}

function fetchThatAnswers(status: number, body?: unknown): ReturnType<typeof vi.fn> {
  const spy = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as Response);
  vi.stubGlobal('fetch', spy);
  return spy;
}

beforeEach(() => {
  fetchThatAnswers(200, conversation);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SharedConversationView', () => {
  it('says it is opening while the fetch is in flight', () => {
    fetchThatHangs();
    render(<SharedConversationView token="tok-abc" />);

    expect(screen.getByTestId('shared-loading')).toHaveTextContent('Opening the conversation…');
    expect(screen.queryByTestId('shared-conversation')).toBeNull();
  });

  it('renders the title, the transcript, and what the page is', async () => {
    render(<SharedConversationView token="tok-abc" />);

    expect(await screen.findByTestId('shared-title')).toHaveTextContent('Planning the 4th');

    const bubbles = screen.getAllByTestId('message-bubble');
    expect(bubbles).toHaveLength(2);
    expect(bubbles[0]).toHaveAttribute('data-sender', 'user');
    expect(bubbles[1]).toHaveAttribute('data-sender', 'agent');
    expect(screen.getByTestId('shared-transcript')).toHaveTextContent('the small place near the port');

    expect(screen.getByTestId('shared-readonly-note')).toHaveTextContent(
      'A read-only copy of one conversation, shared by its owner',
    );
    expect(screen.getByTestId('shared-readonly-note')).toHaveTextContent(
      'This link stops working on 10 Sept 2026',
    );
  });

  it('offers nothing to type into and no way further in', async () => {
    render(<SharedConversationView token="tok-abc" />);
    await screen.findByTestId('shared-conversation');

    expect(screen.queryByLabelText('Type a message')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByTestId('icon-rail')).toBeNull();
    expect(screen.queryByTestId('brief-rail')).toBeNull();
  });

  it('sends no Authorization header — the token in the path is the credential', async () => {
    const spy = fetchThatAnswers(200, conversation);
    render(<SharedConversationView token="tok abc/+1" />);
    await screen.findByTestId('shared-conversation');

    expect(spy).toHaveBeenCalledTimes(1);
    const [path, init] = spy.mock.calls[0] as [string, RequestInit | undefined];
    expect(path).toBe('/api/share/tok%20abc%2F%2B1');
    // No second argument at all: no headers, and so nothing that could carry a
    // stale bearer token from an earlier signed-in visit in this browser.
    expect(init).toBeUndefined();
  });

  it('explains an expired link and offers nothing else', async () => {
    fetchThatAnswers(404);
    render(<SharedConversationView token="tok-old" />);

    expect(await screen.findByTestId('shared-expired')).toHaveTextContent(
      'This link has expired',
    );
    expect(screen.getByTestId('shared-view')).toHaveTextContent(
      'ask the person who sent it for a new link',
    );
    // Nothing to press. A retry would be a lie and a sign-up prompt would be worse.
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByTestId('shared-transcript')).toBeNull();
  });

  it('keeps a transport failure apart from an expired link', async () => {
    fetchThatAnswers(502);
    render(<SharedConversationView token="tok-abc" />);

    expect(await screen.findByTestId('shared-failed')).toHaveTextContent(
      'could not be loaded',
    );
    expect(screen.queryByTestId('shared-expired')).toBeNull();
  });

  it('treats a thrown fetch as a transport failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    render(<SharedConversationView token="tok-abc" />);

    await waitFor(() => expect(screen.getByTestId('shared-failed')).toBeInTheDocument());
  });

  it('renders an empty transcript honestly rather than as a failure', async () => {
    fetchThatAnswers(200, { ...conversation, messages: [] });
    render(<SharedConversationView token="tok-abc" />);

    await screen.findByTestId('shared-conversation');
    expect(screen.getByTestId('shared-transcript')).toHaveTextContent(
      'This conversation has no messages in it.',
    );
  });
});
