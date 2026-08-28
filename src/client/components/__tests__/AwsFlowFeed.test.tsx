import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AwsFlowFeed, REPLAY_COPY, groupFeedRows, type FeedRow } from '../AwsFlowFeed';

function makeRow(overrides: Partial<FeedRow> = {}): FeedRow {
  return {
    key: 'row-1',
    service: 'DynamoDB',
    operation: 'PutItem',
    detail: 'PREF#music',
    durationLabel: '18 ms',
    category: 'database',
    actor: 'Valentin',
    action: 'learns something new',
    ...overrides,
  };
}

describe('groupFeedRows', () => {
  it('returns nothing for no rows', () => {
    expect(groupFeedRows([])).toEqual([]);
  });

  it('collects consecutive rows from the same actor and action', () => {
    const groups = groupFeedRows([
      makeRow({ key: 'a' }),
      makeRow({ key: 'b', operation: 'Query' }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].rows.map((row) => row.key)).toEqual(['a', 'b']);
  });

  it('starts a new group when the action changes', () => {
    const groups = groupFeedRows([
      makeRow({ key: 'a', action: 'writes a reply' }),
      makeRow({ key: 'b', action: 'learns something new' }),
    ]);

    expect(groups.map((group) => group.action)).toEqual(['writes a reply', 'learns something new']);
  });

  /**
   * The mockup keyed on the caption alone. Two adjacent groups that happened to
   * share a caption but had different actors merged into one, attributing the
   * second actor's work to the first.
   */
  it('starts a new group when only the actor changes', () => {
    const groups = groupFeedRows([
      makeRow({ key: 'a', actor: 'User', action: 'opens the app' }),
      makeRow({ key: 'b', actor: 'System', action: 'opens the app' }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.actor)).toEqual(['User', 'System']);
  });

  it('reopens a group when the same actor and action recur non-adjacently', () => {
    const groups = groupFeedRows([
      makeRow({ key: 'a', action: 'writes a reply' }),
      makeRow({ key: 'b', action: 'learns something new' }),
      makeRow({ key: 'c', action: 'writes a reply' }),
    ]);

    // Grouping is by adjacency, not by identity: the feed is a timeline, so
    // hoisting `c` back up to `a` would put it out of chronological order.
    expect(groups).toHaveLength(3);
  });
});

describe('AwsFlowFeed', () => {
  it('renders the heading and summary', () => {
    render(<AwsFlowFeed rows={[]} summary="6 spans · 2 model calls" heading="Live flow" />);
    expect(screen.getByText('Live flow')).toBeInTheDocument();
    expect(screen.getByText('6 spans · 2 model calls')).toBeInTheDocument();
  });

  it('shows the empty message when there is nothing yet', () => {
    render(
      <AwsFlowFeed
        rows={[]}
        summary="0 spans"
        heading="Live flow"
        emptyMessage="Waiting for traffic."
      />,
    );
    expect(screen.getByText('Waiting for traffic.')).toBeInTheDocument();
  });

  it('shows no empty message once rows arrive', () => {
    render(
      <AwsFlowFeed
        rows={[makeRow()]}
        summary="1 span"
        heading="Live flow"
        emptyMessage="Waiting for traffic."
      />,
    );
    expect(screen.queryByText('Waiting for traffic.')).not.toBeInTheDocument();
  });

  it('renders a row per beat', () => {
    render(
      <AwsFlowFeed
        rows={[makeRow({ key: 'a' }), makeRow({ key: 'b' })]}
        summary=""
        heading="Demo flow"
      />,
    );
    expect(screen.getAllByTestId('aws-feed-row')).toHaveLength(2);
  });

  it('shows the operation, detail and duration', () => {
    render(<AwsFlowFeed rows={[makeRow()]} summary="" heading="Demo flow" />);
    expect(screen.getByText('PutItem')).toBeInTheDocument();
    expect(screen.getByText(/PREF#music/)).toBeInTheDocument();
    expect(screen.getByText('18 ms')).toBeInTheDocument();
  });

  it('marks the current row', () => {
    render(
      <AwsFlowFeed
        rows={[makeRow({ key: 'a' }), makeRow({ key: 'b', isCurrent: true })]}
        summary=""
        heading="Demo flow"
      />,
    );

    const current = screen
      .getAllByTestId('aws-feed-row')
      .filter((row) => row.getAttribute('data-current') === 'true');
    expect(current).toHaveLength(1);
  });

  /** On stage the thing that just happened is the thing being talked about. */
  it('puts the newest group first and the newest row first within it', () => {
    render(
      <AwsFlowFeed
        rows={[
          makeRow({ key: 'first', action: 'writes a reply', operation: 'Converse' }),
          makeRow({ key: 'second', operation: 'PutItem' }),
          makeRow({ key: 'third', operation: 'Query' }),
        ]}
        summary=""
        heading="Demo flow"
      />,
    );

    const groups = screen.getAllByTestId('aws-feed-group');
    expect(groups[0]).toHaveTextContent('learns something new');

    const rows = screen.getAllByTestId('aws-feed-row');
    expect(rows[0]).toHaveTextContent('Query');
    expect(rows[rows.length - 1]).toHaveTextContent('Converse');
  });

  it('shows an em dash for a beat that was a delivery rather than a call', () => {
    render(<AwsFlowFeed rows={[makeRow({ durationLabel: '—' })]} summary="" heading="Demo flow" />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

/**
 * Choosing a user action out of the log.
 *
 * The feed already grouped its rows by actor and action, but the groups were
 * captions: there was no way to say "that one — show me its steps again". These are
 * the affordance that turns the log into an index of the conversation.
 */
describe('choosing a user action', () => {
  const ROWS = [
    makeRow({ key: 'a', actor: 'User', action: 'sends a message in chat', operation: 'Send' }),
    makeRow({ key: 'b', actor: 'Valentin', action: 'writes a reply', operation: 'Converse' }),
    makeRow({ key: 'c', actor: 'Valentin', action: 'writes a reply', operation: 'Query' }),
  ];

  it('leaves the groups as plain captions when there is nothing to replay to', () => {
    render(<AwsFlowFeed rows={ROWS} summary="" heading="Demo flow" />);

    // A control that did nothing would be a worse lie than no control.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers each group as a control when replay is available', () => {
    render(<AwsFlowFeed rows={ROWS} summary="" heading="Demo flow" onSelectGroup={() => {}} />);

    const headers = screen.getAllByTestId('aws-feed-group-header');
    expect(headers).toHaveLength(2);
    // A button, not a clickable div: the presenter's hand is not always on a mouse.
    expect(headers[0].tagName).toBe('BUTTON');
  });

  it('hands back the chosen group with all of its steps', async () => {
    const chosen: string[][] = [];
    render(
      <AwsFlowFeed
        rows={ROWS}
        summary=""
        heading="Demo flow"
        onSelectGroup={(group) => chosen.push(group.rows.map((row) => row.key))}
      />,
    );

    const user = userEvent.setup();
    // Newest group first, so "writes a reply" is the one on top.
    await user.click(screen.getAllByTestId('aws-feed-group-header')[0]);

    // Chronological, not the reversed display order: a replay has to run forwards.
    expect(chosen).toEqual([['b', 'c']]);
  });

  it('identifies a group by its first row rather than its position', () => {
    // Position changes the moment a new beat arrives, which would slide the
    // selection onto a different action mid-replay.
    render(<AwsFlowFeed rows={ROWS} summary="" heading="Demo flow" onSelectGroup={() => {}} />);

    const ids = screen.getAllByTestId('aws-feed-group').map((group) => group.dataset.groupId);
    expect(ids).toEqual(['b', 'a']);
  });

  it('folds the other actions away so the chosen one is what you see', () => {
    render(
      <AwsFlowFeed
        rows={ROWS}
        summary=""
        heading="Replay"
        onSelectGroup={() => {}}
        selectedGroupId="b"
      />,
    );

    // Both captions stay — you still need to be able to pick another one — but only
    // the chosen action's steps are listed.
    expect(screen.getAllByTestId('aws-feed-group')).toHaveLength(2);
    expect(screen.getAllByTestId('aws-feed-row')).toHaveLength(2);
    expect(screen.queryByText('Send')).not.toBeInTheDocument();
  });

  it('marks the group being replayed as pressed', () => {
    render(
      <AwsFlowFeed
        rows={ROWS}
        summary=""
        heading="Replay"
        onSelectGroup={() => {}}
        selectedGroupId="b"
      />,
    );

    const headers = screen.getAllByTestId('aws-feed-group-header');
    expect(headers[0]).toHaveAttribute('aria-pressed', 'true');
    expect(headers[1]).toHaveAttribute('aria-pressed', 'false');
    expect(headers[0]).toHaveTextContent(REPLAY_COPY.replaying);
  });
});
