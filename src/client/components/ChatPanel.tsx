import { v4 as uuidv4 } from 'uuid';
import { useChatContext } from '../context/chat-context';
import { useWebSocketContext } from '../context/websocket-context';
import { useOptionalProfileStoreContext } from '../context/profile-store-context';
import { MessageHistory } from './MessageHistory';
import { MessageInput } from './MessageInput';
import { TypingIndicator } from './TypingIndicator';
import { ConnectionBanner } from './ConnectionBanner';
import { GuidedIntro } from './GuidedIntro';
import { colors, insets, typography } from '../design-system/tokens';
import { chatMeasureStyle } from './chat-measure';
import type { ChatMessage } from '../../shared/interfaces/message';

/**
 * The cream chat column. `minHeight: 0` matters even though this is also a
 * `height: 100%` box: it is a flex child of the window cell, and without it the
 * transcript's intrinsic height wins and the composer is pushed off the bottom
 * (option-5d-brief.html:41-42).
 */
const panelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
  minWidth: 0,
  backgroundColor: colors.porcelain,
};

/** Name + status row above the transcript (option-5d-brief.html:43-45). */
const headStyle: React.CSSProperties = {
  padding: `${insets.snug}px ${insets.roomy}px 13px`,
  flexShrink: 0,
};

/**
 * The name itself, held to the transcript's centred measure.
 *
 * The hairline below stays full-bleed — a seam across the column is the point of
 * it — but the name has to line up with the bubbles it labels, or at wide widths
 * it sits alone against the left edge of an otherwise centred column.
 */
const headInnerStyle: React.CSSProperties = {
  ...chatMeasureStyle,
  display: 'flex',
  alignItems: 'center',
  gap: 11,
};

const headNameStyle: React.CSSProperties = {
  fontFamily: typography.headingFontFamily,
  fontSize: typography.px.headingMd,
  fontWeight: typography.weights.normal,
  color: colors.ink,
};

const headStatusStyle: React.CSSProperties = {
  fontStyle: 'normal',
  fontSize: typography.px.labelLoose,
  fontFamily: typography.bodyFontFamily,
  color: colors.inkMuted,
  display: 'block',
  // Pulls the status up under the serif name, whose line box leaves a gap.
  marginTop: -2,
};

/**
 * The hairline under the header. It fades out at both ends rather than butting
 * into the column edges, so the rule reads as a seam and not as a border.
 */
const separatorStyle: React.CSSProperties = {
  height: 1,
  background: colors.hairlineGradient,
  flexShrink: 0,
};

export function ChatPanel() {
  const { state, dispatch } = useChatContext();
  const { sendMessage, confirmAction } = useWebSocketContext();
  // Optional: the chat column renders standalone in tests and on mobile, where
  // the profile store is not necessarily above it.
  const profileStore = useOptionalProfileStoreContext();
  const partnerName = profileStore?.getFieldValue('partner_name')?.value ?? null;

  const handleSubmit = () => {
    const content = state.inputValue.trim();
    if (!content) return;

    const message: ChatMessage = {
      id: uuidv4(),
      sessionId: state.sessionId ?? '',
      sender: 'user',
      content,
      timestamp: new Date().toISOString(),
    };

    dispatch({ type: 'SEND_MESSAGE', message });
    sendMessage(content);
  };

  /*
   * Marked confirmed as soon as the frame goes out, not when the result comes
   * back. The tool takes seconds — Ontopo and Gmail are both round trips — and a
   * Confirm button that stays live for those seconds gets pressed twice. If the
   * action fails, the agent says so in the reply that follows.
   */
  const handleConfirmProposal = (proposalId: string) => {
    dispatch({ type: 'RESOLVE_PROPOSAL', proposalId, status: 'confirmed' });
    confirmAction(proposalId);
  };

  // Dismissal is local: the server holds proposals in memory and lets them
  // expire, so there is nothing to tell it. Saying "not now" is not an event
  // worth spending a turn on.
  const handleDismissProposal = (proposalId: string) => {
    dispatch({ type: 'RESOLVE_PROPOSAL', proposalId, status: 'dismissed' });
  };

  const messageCount = state.messages.length;
  const status =
    messageCount === 0
      ? 'Getting to know her'
      : `Getting to know her · ${messageCount} message${messageCount === 1 ? '' : 's'}`;

  return (
    <div style={panelStyle} data-testid="chat-panel">
      <ConnectionBanner status={state.connectionStatus} />
      <div style={headStyle} data-testid="chat-header">
        <div style={headInnerStyle}>
          <div>
            {/* The head names the person being profiled. Until she has a name,
                it says so rather than borrowing the agent's. */}
            <b style={headNameStyle}>{partnerName ?? 'Someone special'}</b>
            <em style={headStatusStyle}>{status}</em>
          </div>
        </div>
      </div>
      <div style={separatorStyle} />
      {/* Renders nothing once there is a conversation or a profile — see its own
          note. It sits above the transcript rather than inside it so the messages
          it produces are ordinary messages. */}
      <GuidedIntro />
      <MessageHistory
        messages={state.messages}
        proposals={state.proposals}
        onConfirmProposal={handleConfirmProposal}
        onDismissProposal={handleDismissProposal}
      />
      <TypingIndicator isVisible={state.isTyping} />
      <MessageInput
        value={state.inputValue}
        onChange={(value) => dispatch({ type: 'SET_INPUT', value })}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
