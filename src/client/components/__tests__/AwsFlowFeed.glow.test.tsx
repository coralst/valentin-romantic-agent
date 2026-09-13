import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AwsFlowFeed, GLOW_COPY, type FeedRow } from '../AwsFlowFeed';
import type { GlowTarget } from '../../utils/glow-target';

const REPLY: GlowTarget = { kind: 'message', messageId: 'message-9' };

function makeRow(overrides: Partial<FeedRow> = {}): FeedRow {
  return {
    key: 'row-1',
    service: 'Bedrock',
    operation: 'agent_message',
    detail: 'reply streamed',
    durationLabel: '—',
    category: 'ml',
    actor: 'Valentin',
    action: 'writes a reply',
    ...overrides,
  };
}

/** The feed folds by default, and a step only exists once its group is open. */
function renderFeed(props: Partial<React.ComponentProps<typeof AwsFlowFeed>> = {}) {
  return render(
    <AwsFlowFeed
      rows={[makeRow({ targets: [REPLY] })]}
      summary="1 event"
      heading="Live flow"
      startExpanded
      {...props}
    />,
  );
}

describe('AwsFlowFeed — pointing at a step to light up what it produced', () => {
  it('makes a step that produced something a real control', () => {
    renderFeed({ onSelectRow: vi.fn() });

    const row = screen.getByTestId('aws-feed-row');
    expect(row.tagName).toBe('BUTTON');
    expect(row).toHaveAccessibleName(`${GLOW_COPY.action}: Bedrock agent_message`);
  });

  it('leaves a step that produced nothing as a caption', () => {
    // `typing_stop` and a Bedrock span have nothing to glow. A button that does
    // nothing when pressed invites a presenter to press it again on stage.
    renderFeed({ rows: [makeRow({ targets: [] })], onSelectRow: vi.fn() });

    expect(screen.getByTestId('aws-feed-row').tagName).toBe('DIV');
  });

  it('leaves every step a caption when nobody is listening for a pick', () => {
    renderFeed();

    expect(screen.getByTestId('aws-feed-row').tagName).toBe('DIV');
  });

  it('hands the step over when it is picked', async () => {
    const onSelectRow = vi.fn();
    renderFeed({ onSelectRow });

    await userEvent.click(screen.getByTestId('aws-feed-row'));

    expect(onSelectRow).toHaveBeenCalledWith(expect.objectContaining({ key: 'row-1' }));
  });

  it('previews on the way in and lets go on the way out', async () => {
    const onHoverRow = vi.fn();
    renderFeed({ onSelectRow: vi.fn(), onHoverRow });

    const row = screen.getByTestId('aws-feed-row');
    await userEvent.hover(row);
    expect(onHoverRow).toHaveBeenLastCalledWith(expect.objectContaining({ key: 'row-1' }));

    await userEvent.unhover(row);
    expect(onHoverRow).toHaveBeenLastCalledWith(null);
  });

  it('previews a whole action from its caption, and lets go on the way out', async () => {
    const onHoverGroup = vi.fn();
    renderFeed({ onHoverGroup });

    const header = screen.getByTestId('aws-feed-group-header');
    await userEvent.hover(header);
    expect(onHoverGroup).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'writes a reply' }),
    );

    await userEvent.unhover(header);
    expect(onHoverGroup).toHaveBeenLastCalledWith(null);
  });

  it('says which step is held on, so the list agrees with the app', () => {
    renderFeed({ onSelectRow: vi.fn(), glowingKey: 'row-1' });

    const row = screen.getByTestId('aws-feed-row');
    expect(row).toHaveAttribute('data-glowing', 'true');
    expect(row).toHaveAttribute('aria-pressed', 'true');
  });

  it('says which action is held on', () => {
    renderFeed({ onHoverGroup: vi.fn(), glowingKey: 'row-1' });

    expect(screen.getByTestId('aws-feed-group')).toHaveAttribute('data-glowing', 'true');
  });

  it('keeps the fold control separate from the pick', async () => {
    const onSelectRow = vi.fn();
    renderFeed({ onSelectRow });

    await userEvent.click(screen.getByTestId('aws-feed-group-fold'));

    // Folding hides the steps rather than selecting one of them.
    expect(onSelectRow).not.toHaveBeenCalled();
    expect(screen.queryByTestId('aws-feed-row')).not.toBeInTheDocument();
  });
});
