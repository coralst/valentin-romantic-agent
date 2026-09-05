import { useEffect, useMemo, useRef, useState } from 'react';

import type { ChatMessage } from '../../shared/interfaces/message';
import type { PreferenceWithHistory } from '../../shared/interfaces/preference';
import { MessageBubble } from './MessageBubble';
import { LearnedStatus, type LearnedAnnouncement } from './LearnedStatus';
import { NotedBadge } from './NotedBadge';
import { ProposalCard } from './ProposalCard';
import { usePreferencesContext } from '../context/preferences-context';
import { discoveryKey } from '../hooks/use-preferences-state';
import type { ProposalEntry } from '../hooks/use-chat-state';
import { buildNotedIndex } from '../utils/noted-index';
import { insets, layout, typography } from '../design-system/tokens';
import { chatMeasureStyle } from './chat-measure';

interface MessageHistoryProps {
  messages: ChatMessage[];
  /**
   * Ids that arrived while this transcript was mounted — see `ChatState`. Only
   * these may animate; omitting it means "none of them did", which is the right
   * default for a transcript being rendered from stored messages.
   */
  liveMessageIds?: ReadonlySet<string>;
  /** Proposals awaiting a yes, plus the ones already answered. */
  proposals?: ProposalEntry[];
  onConfirmProposal?: (proposalId: string) => void;
  onDismissProposal?: (proposalId: string) => void;
}

const containerStyle: React.CSSProperties = {
  flex: 1,
  // A column, so an empty transcript's placeholder can be told to fill the track
  // rather than sitting as a line of text at the top of a tall blank area.
  display: 'flex',
  flexDirection: 'column',
  // Load-bearing: without it this flex child sizes to the whole transcript and
  // shoves the composer out through the bottom of the window
  // (option-5d-brief.html:41-42,47).
  minHeight: 0,
  minWidth: 0,
  overflowY: 'auto',
  padding: `20px ${insets.roomy}px 10px`,
};

/** Caps the measure of the transcript without narrowing the scroll gutter. */
const innerStyle: React.CSSProperties = chatMeasureStyle;

/**
 * What fills the transcript before anything has been said.
 *
 * There was nothing here, and on a wide screen with the architecture drawer open
 * that read as a rendering fault: the column is at its widest exactly when the
 * transcript is at its shortest, so a new session showed several hundred pixels of
 * blank cream between the header and the composer. Seeding the demo profile lands
 * you here too — it opens its own session, which has no greeting in it yet.
 *
 * Centred in the track rather than pinned to the top, because a line of grey text
 * under the header looks like the first message failed to load.
 */
const emptyMeasureStyle: React.CSSProperties = {
  // The measure box, told to fill the track so what is centred inside it is
  // centred in the column rather than tucked under the header. Kept as a variant
  // of `chatMeasureStyle` rather than a sibling of it: the header, the transcript
  // and the composer are asserted to share one measure, and the transcript's
  // contribution to that is this element (AppLayout.scaling.test.tsx).
  ...chatMeasureStyle,
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
};

const emptyTranscriptStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'grid',
  placeItems: 'center',
  padding: '24px 0',
};

const emptyTranscriptCopyStyle: React.CSSProperties = {
  margin: 0,
  maxWidth: '34ch',
  textAlign: 'center',
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.label,
  lineHeight: 1.6,
  color: 'rgba(42, 34, 38, 0.55)',
};

/**
 * Lines up a badge under an agent bubble with the bubble itself.
 *
 * The same 44px the transient uses — avatar (32) plus the bubble gap (12) — so the
 * marker starts where Valentin's bubbles start rather than under their crests.
 * User turns need no equivalent: they are right-aligned to the same edge as their
 * bubble, so mirroring the row is enough.
 */
const agentBadgeSlotStyle: React.CSSProperties = {
  marginLeft: layout.messageAvatarSize + 12,
};

/** Within a bubble's height of the foot counts as "following along". */
const FOLLOW_THRESHOLD_PX = 120;

export function MessageHistory({
  messages,
  liveMessageIds,
  proposals = [],
  onConfirmProposal,
  onDismissProposal,
}: MessageHistoryProps) {
  const { state: preferencesState } = usePreferencesContext();

  /**
   * The batch announced most recently, handed to `LearnedStatus` which decides
   * how long it stays on screen.
   *
   * This line is still deliberately un-anchored: it belongs to the moment, not to
   * a message, so it sits at the tail where its arrival and departure can displace
   * nothing. The *permanent* marker is what is anchored, via `notedIndex` below —
   * possible now that the client sends its uuid with the turn and the server adopts
   * it, so `sourceMessageId` finally names a message the transcript is holding.
   * Before that the anchor could only ever have been a guess ("whatever was last
   * in the transcript when the fact arrived").
   */
  const [announcement, setAnnouncement] = useState<LearnedAnnouncement | null>(null);

  /**
   * Discoveries already announced, keyed the same way the store keys them.
   *
   * This is only a within-mount dedupe — the store's `discovered` set is what
   * decides whether a fact is announceable at all. It has to be, because this ref
   * resets on remount and a session switch remounts the transcript: on its own it
   * would announce a restored conversation's entire dossier all over again.
   */
  const announcedRef = useRef(new Set<string>());

  const visiblePreferences = useMemo(() => {
    const all: PreferenceWithHistory[] = [];
    for (const list of Object.values(preferencesState.preferences)) all.push(...list);
    return all;
  }, [preferencesState.preferences]);

  /**
   * Which facts are on the record against which message.
   *
   * Derived from `preferences` — every known row, including those hydrated by
   * `LOAD_PREFERENCES` — and never from `discovered`, which is emptied on load by
   * design. See `noted-index.ts` for why that distinction is the whole feature.
   */
  const notedIndex = useMemo(
    () => buildNotedIndex(preferencesState.preferences),
    [preferencesState.preferences],
  );

  const lastMessage = messages[messages.length - 1];

  useEffect(() => {
    const fresh = visiblePreferences.filter(
      (pref) =>
        preferencesState.discovered.has(discoveryKey(pref)) &&
        !announcedRef.current.has(discoveryKey(pref)),
    );
    if (fresh.length === 0) return;
    for (const pref of fresh) announcedRef.current.add(discoveryKey(pref));
    /*
     * One line for the whole batch. A single sentence routinely teaches Valentin
     * two unrelated things and the server is right to emit them as separate
     * events — merging them in the store would corrupt the dossier — but two
     * status lines saying almost the same thing is the stacked-card bug again in
     * a quieter font.
     */
    setAnnouncement({
      id: fresh.map((pref) => pref.id).join('|'),
      values: fresh.map((pref) => pref.value),
    });
  }, [visiblePreferences, preferencesState.discovered]);

  /*
   * Stay at the foot of the transcript while the newest reply is still growing.
   *
   * This used to be a single `bottomRef.current?.scrollIntoView()` keyed on
   * `[messages.length, proposals.length]`, which fired once — before the message
   * had its final height. Valentin's replies are typewriter-revealed a character at
   * a time (`MessageBubble` → `useTypewriter`, 18ms/char), and `TypingIndicator` is
   * a flex sibling that mounts and unmounts between the log and the composer. Both
   * resize the transcript *after* that one scroll, so a long reply ended up cut off
   * mid-sentence with the composer over it and empty space below.
   *
   * A `ResizeObserver` on the content box follows the growth instead. Two
   * deliberate choices:
   *
   * - `scrollTop = scrollHeight` on the container, not `scrollIntoView`. The latter
   *   walks *every* scrollable ancestor, which already sheared the window grid once
   *   (see the note in `AppLayout`) and left `overflow: hidden` on `panelHostStyle`
   *   as the band-aid. Scrolling the one element we own cannot do that.
   * - Only when the view is already near the bottom. Someone reading back through
   *   the conversation must not be yanked forward by a reply still typing itself.
   */
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    const stickToBottom = () => {
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      if (distanceFromBottom <= FOLLOW_THRESHOLD_PX) {
        container.scrollTop = container.scrollHeight;
      }
    };

    // `ResizeObserver` is not implemented in every test environment, and a
    // transcript that does not auto-scroll is far better than one that throws.
    if (typeof ResizeObserver === 'undefined') {
      stickToBottom();
      return;
    }

    const observer = new ResizeObserver(stickToBottom);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  /*
   * A new message or proposal jumps to the foot unconditionally.
   *
   * Distinct from the observer above, which only *follows* growth: sending a message
   * should bring you back down even if you had scrolled up to re-read something. A
   * proposal counts for the same reason it always did — a Confirm button below the
   * fold is a Confirm button nobody presses.
   */
  useEffect(() => {
    const container = containerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages.length, proposals.length]);

  // `proposals` counts: a session whose only content is a card awaiting a yes is
  // not empty, and telling its owner to start talking would be wrong.
  const isEmpty = messages.length === 0 && proposals.length === 0;

  return (
    <div role="log" ref={containerRef} style={containerStyle} aria-label="Message history">
      <div ref={contentRef} style={isEmpty ? emptyMeasureStyle : innerStyle}>
        {isEmpty && (
          <div style={emptyTranscriptStyle} data-testid="transcript-empty">
            <p style={emptyTranscriptCopyStyle}>
              Nothing said yet. Tell Valentin something about her — a food she loves, a
              place she talks about — and he will start keeping track.
            </p>
          </div>
        )}
        {messages.map((msg) => {
          /*
           * The badge waits until its message is no longer the tail.
           *
           * While the turn is in flight the user's message *is* the tail and the
           * transient `LearnedStatus` is covering it, so showing both would say
           * the same thing twice — once to the eye and twice to a screen reader.
           * Once the reply lands, the reply's append has already run the
           * unconditional scroll-to-foot below, so mounting the badge in that same
           * commit costs no perceived movement. This is what keeps the
           * no-layout-jump guarantee those two effects were written for.
           */
          const noted = msg.id === lastMessage?.id ? undefined : notedIndex.get(msg.id);
          return (
            <div key={msg.id}>
              <MessageBubble
                message={msg}
                /*
                 * Only the newest message animates, and only if it arrived rather
                 * than being loaded. Without the second half, opening a
                 * conversation re-types Valentin's last reply at you — which reads
                 * as the app rewriting what he already said.
                 */
                animate={
                  msg.id === lastMessage?.id &&
                  msg.sender === 'agent' &&
                  liveMessageIds?.has(msg.id) === true
                }
              />
              {noted && (
                <div style={msg.sender === 'agent' ? agentBadgeSlotStyle : undefined}>
                  <NotedBadge values={noted} align={msg.sender === 'user' ? 'end' : 'start'} />
                </div>
              )}
            </div>
          );
        })}
        {/*
          At the tail of the transcript rather than beside the message that
          produced it: nothing is ever rendered below the line, so its arrival
          and departure cannot displace anything the user is reading.
        */}
        <LearnedStatus announcement={announcement} />
        {/*
          Proposals sit at the tail rather than beside the message that raised
          them, for the same reason: nothing renders below the newest one, so a
          card appearing cannot push the sentence being read up off the screen.
          They are also the live part of the transcript — whatever is still
          awaiting a yes should be the last thing on screen.
        */}
        {proposals.map((entry) => (
          <ProposalCard
            key={entry.proposal.proposalId}
            proposal={entry.proposal}
            status={entry.status}
            onConfirm={(id) => onConfirmProposal?.(id)}
            onDismiss={(id) => onDismissProposal?.(id)}
          />
        ))}
      </div>
    </div>
  );
}
