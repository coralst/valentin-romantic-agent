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
        startExpanded
      />,
    );
    expect(screen.getAllByTestId('aws-feed-row')).toHaveLength(2);
  });

  it('shows the operation, detail and duration', () => {
    render(<AwsFlowFeed rows={[makeRow()]} summary="" heading="Demo flow" startExpanded />);
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
        startExpanded
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
        startExpanded
      />,
    );

    const groups = screen.getAllByTestId('aws-feed-group');
    expect(groups[0]).toHaveTextContent('learns something new');

    const rows = screen.getAllByTestId('aws-feed-row');
    expect(rows[0]).toHaveTextContent('Query');
    expect(rows[rows.length - 1]).toHaveTextContent('Converse');
  });

  it('shows an em dash for a beat that was a delivery rather than a call', () => {
    render(
      <AwsFlowFeed
        rows={[makeRow({ durationLabel: '—' })]}
        summary=""
        heading="Demo flow"
        startExpanded
      />,
    );
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

    // A control that did nothing would be a worse lie than no control. The fold
    // controls are still buttons — folding works with or without a replay — so what
    // must be absent is the header *itself* being pressable.
    for (const header of screen.getAllByTestId('aws-feed-group-header')) {
      expect(header.tagName).not.toBe('BUTTON');
      expect(header).not.toHaveAttribute('aria-pressed');
    }
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

/**
 * Folding.
 *
 * A turn is a dozen spans, and the panel is a column beside the diagram: expanded,
 * three turns of traffic pushed the actions a presenter has to point at off the
 * bottom. So the feed opens as an index of actions and reveals steps on request.
 */
describe('folding an action away', () => {
  const ROWS = [
    makeRow({ key: 'a', actor: 'User', action: 'sends a message in chat', operation: 'Send' }),
    makeRow({ key: 'b', actor: 'Valentin', action: 'writes a reply', operation: 'Converse' }),
    makeRow({ key: 'c', actor: 'Valentin', action: 'writes a reply', operation: 'Query' }),
  ];

  it('starts folded, showing the actions and not their steps', () => {
    render(<AwsFlowFeed rows={ROWS} summary="" heading="Live flow" />);

    expect(screen.getAllByTestId('aws-feed-group')).toHaveLength(2);
    expect(screen.queryAllByTestId('aws-feed-row')).toHaveLength(0);
    // The caption still says how much is folded underneath it.
    expect(screen.getAllByTestId('aws-feed-group-header')[0]).toHaveTextContent('2');
  });

  it('unfolds one action without unfolding the rest', async () => {
    render(<AwsFlowFeed rows={ROWS} summary="" heading="Live flow" />);

    const user = userEvent.setup();
    // Newest first, so 'writes a reply' and its two steps are on top.
    await user.click(screen.getAllByTestId('aws-feed-group-fold')[0]);

    expect(screen.getAllByTestId('aws-feed-row')).toHaveLength(2);
    expect(screen.queryByText('Send')).not.toBeInTheDocument();
  });

  it('folds an unfolded action again', async () => {
    render(<AwsFlowFeed rows={ROWS} summary="" heading="Live flow" startExpanded />);

    const user = userEvent.setup();
    const fold = () => screen.getAllByTestId('aws-feed-group-fold')[0];
    expect(fold()).toHaveAttribute('aria-expanded', 'true');

    await user.click(fold());

    expect(fold()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getAllByTestId('aws-feed-row')).toHaveLength(1);
  });

  it('unfolds and refolds everything at once', async () => {
    render(<AwsFlowFeed rows={ROWS} summary="" heading="Live flow" />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId('aws-feed-fold-all'));
    expect(screen.getAllByTestId('aws-feed-row')).toHaveLength(3);

    // The one control flips to the thing that would now do something.
    await user.click(screen.getByTestId('aws-feed-fold-all'));
    expect(screen.queryAllByTestId('aws-feed-row')).toHaveLength(0);
  });

  /*
   * An action that arrives after the presenter unfolded another one must not unfold
   * itself — the fold state is per action, and a growing log that keeps re-expanding
   * is the problem folding was added to solve.
   */
  it('folds an action that arrives later, even while another is open', async () => {
    const { rerender } = render(<AwsFlowFeed rows={ROWS} summary="" heading="Live flow" />);

    const user = userEvent.setup();
    await user.click(screen.getAllByTestId('aws-feed-group-fold')[0]);
    expect(screen.getAllByTestId('aws-feed-row')).toHaveLength(2);

    rerender(
      <AwsFlowFeed
        rows={[...ROWS, makeRow({ key: 'd', action: 'asks the outside world' })]}
        summary=""
        heading="Live flow"
      />,
    );

    // Still the two steps of the action that was opened by hand, and nothing else.
    expect(screen.getAllByTestId('aws-feed-row')).toHaveLength(2);
    expect(screen.getAllByTestId('aws-feed-group')).toHaveLength(3);
  });

  /** The replayed action is shown whether or not anyone unfolded it. */
  it('keeps the replayed action open without a fold click', () => {
    render(
      <AwsFlowFeed
        rows={ROWS}
        summary=""
        heading="Replay"
        onSelectGroup={() => {}}
        selectedGroupId="b"
      />,
    );

    expect(screen.getAllByTestId('aws-feed-row')).toHaveLength(2);
  });
});

/**
 * Timestamps.
 *
 * "When did that happen" was unanswerable from the panel: it showed how long each
 * call took but never what time it was, so a span in the log could not be lined up
 * against anything outside the app — a CloudWatch entry, or the moment on stage.
 */
describe('showing when a beat happened', () => {
  it('shows the time beside the duration', () => {
    render(
      <AwsFlowFeed
        rows={[makeRow({ timeLabel: '14:07:22' })]}
        summary=""
        heading="Live flow"
        startExpanded
      />,
    );

    expect(screen.getByTestId('aws-feed-row-time')).toHaveTextContent('14:07:22');
    // Not at the cost of the duration, which answers a different question.
    expect(screen.getByText('18 ms')).toBeInTheDocument();
  });

  it('leaves the time blank for a scripted step that happened at no time', () => {
    render(<AwsFlowFeed rows={[makeRow()]} summary="" heading="Demo flow" startExpanded />);

    // Present but empty: the column stays reserved so a mixed list keeps one set of
    // columns, and an invented time would be worse than none.
    expect(screen.getByTestId('aws-feed-row-time')).toHaveTextContent('');
    expect(screen.queryByTestId('aws-feed-group-time')).not.toBeInTheDocument();
  });

  it('shows the newest step time on a folded action', () => {
    render(
      <AwsFlowFeed
        rows={[
          makeRow({ key: 'a', timeLabel: '14:07:22' }),
          makeRow({ key: 'b', timeLabel: '14:07:25' }),
        ]}
        summary=""
        heading="Live flow"
      />,
    );

    // Folded, so this is the only time on screen — it has to be the beat that was
    // just talked about, not the one the action opened with.
    expect(screen.queryAllByTestId('aws-feed-row')).toHaveLength(0);
    expect(screen.getByTestId('aws-feed-group-time')).toHaveTextContent('14:07:25');
  });
});
