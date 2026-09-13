import type { AgentActivityPayload, AwsSpan } from '../../shared/interfaces/ws-events';
import type { ObservedWsEvent } from './ws-event-observer';
import { resolveByFieldId, resolveField } from './preference-field-mapper';
import { DEMO_SEED_SOURCE_MESSAGE_ID } from './provenance';

/**
 * What a beat in the architecture feed *produced on screen*.
 *
 * The drawer already answers "what was the call". This is the other direction:
 * given a row in the feed, which pixels in the app does it account for. Pointing
 * at a row and having the reply it wrote light up is the one gesture that turns
 * the panel from a log into an explanation — and it is the only way to show a
 * room that the architecture diagram and the conversation are the same event.
 *
 * ---
 * WHY IDS ARE SAFE TO CARRY HERE
 *
 * `describeAwsEvent` reduces a `preference_update` to `new · food` on purpose:
 * the drawer is on a projector, and a preference's *value* must never reach it
 * (`aws-architecture.ts`, `ws-events.ts`). That rule is about values, and these
 * are ids — opaque, already on the wire, and never rendered. A target is used to
 * *find* an element that is already on screen, so it can reveal nothing the
 * viewer cannot already read.
 *
 * ---
 * WHY A TARGET IS NOT A DOM NODE
 *
 * A beat is recorded when the event arrives, which is routinely before the thing
 * it produced has mounted — and a beat outlives it, because live beats are kept
 * for `LIVE_BEAT_LIMIT` while the transcript is switched underneath them.
 * Resolving to an element at ingest would capture a node that is about to be
 * unmounted; resolving at click time cannot, so a target stays a *description*
 * until someone points at it.
 */
export type GlowTarget =
  /** One turn in the transcript. */
  | { kind: 'message'; messageId: string }
  /**
   * One fact Valentin learned.
   *
   * Two anchors, because a preference is on screen twice: the permanent `Noted`
   * badge under the message that taught it, and its chip in the brief rail. Both
   * are optional — a fact whose originating message is not in this transcript
   * still has a chip, and an off-registry fact (an allergy, a dislike) has a
   * badge but no chip. Carrying both and glowing whichever exists is what keeps
   * the gesture from silently doing nothing.
   */
  | { kind: 'preference'; preferenceId: string; sourceMessageId?: string; fieldId?: string }
  /** One integration Valentin called — the strip tile, and the call's own row. */
  | { kind: 'tool'; service: string }
  /** One thing awaiting a yes. */
  | { kind: 'proposal'; proposalId: string; service?: string };

/**
 * Identity of a target, for de-duplicating the union of a group's rows.
 *
 * A group is a run of consecutive beats (`groupFeedRows`), so "Valentin learns
 * something new" routinely holds the same preference twice — the event and the
 * DynamoDB write that followed it. Glowing it twice is not wrong, but painting
 * the same node from two targets makes the cleanup order matter, and that is a
 * bug waiting to be written.
 */
export function glowTargetKey(target: GlowTarget): string {
  switch (target.kind) {
    case 'message':
      return `message:${target.messageId}`;
    case 'preference':
      return `preference:${target.preferenceId}`;
    case 'tool':
      return `tool:${target.service}`;
    case 'proposal':
      return `proposal:${target.proposalId}`;
  }
}

/** Drop repeats while keeping the order the beats happened in. */
export function dedupeGlowTargets(targets: readonly GlowTarget[]): readonly GlowTarget[] {
  const seen = new Set<string>();
  const unique: GlowTarget[] = [];
  for (const target of targets) {
    const key = glowTargetKey(target);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(target);
  }
  return unique;
}

/**
 * Ids that are safe to interpolate into an attribute selector.
 *
 * Every id this module handles is a uuid, a registry field id or an
 * `IntegrationId` — all of which match this. The guard is here for the one that
 * will not: a server that starts minting ids with a quote in them would
 * otherwise turn `querySelectorAll` into a syntax error and take the whole
 * drawer down with it. A skipped anchor is a glow that does not happen; a thrown
 * selector is a blank panel.
 */
const SAFE_ID = /^[A-Za-z0-9_:.-]+$/;

function attribute(name: string, value: string | undefined): string | null {
  if (!value || !SAFE_ID.test(value)) return null;
  return `[${name}="${value}"]`;
}

/**
 * Where on screen a target might be, as CSS selectors.
 *
 * Attribute selectors rather than a React context threaded into five component
 * trees. The state being expressed — "this one, right now" — is exactly what
 * this codebase already puts on sibling `data-*` attributes (`data-current`,
 * `data-selected`, `data-expanded`), the glow has to reach four unrelated
 * subtrees at once, and the scroll it triggers needs the element anyway. Wiring
 * it as props would mean a new prop on `MessageBubble`, `NotedBadge`,
 * `GoodToKnow`, `ProposalCard` and `IntegrationStatusStrip`, all to carry state
 * none of them has any other use for.
 *
 * More than one selector per target is normal and not a fallback chain: a
 * preference is genuinely in two places, and a tool call is in three. Every
 * match glows.
 */
export function glowSelectors(target: GlowTarget): readonly string[] {
  switch (target.kind) {
    case 'message': {
      const selector = attribute('data-message-id', target.messageId);
      return selector ? [selector] : [];
    }
    case 'preference': {
      return [
        attribute('data-noted-for', target.sourceMessageId),
        attribute('data-field-id', target.fieldId),
      ].filter((selector): selector is string => selector !== null);
    }
    case 'tool': {
      const tile = attribute('data-testid', `integration-status-${target.service}`);
      const row = attribute('data-service', target.service);
      /*
       * The `+N` chip, for a service the strip folded away.
       *
       * `MAX_TILES` in `IntegrationStatusStrip` means a deployment with more
       * integrations than tiles has no tile for some of them — and dev has
       * exactly that, so `check_shabbat` glowed nothing there while it glowed
       * the hebcal tile locally. The chip is the only element on screen that
       * honestly stands for a folded service, so it is the anchor of last
       * resort rather than a silent no-op.
       */
      const overflow =
        SAFE_ID.test(target.service) && target.service
          ? `[data-overflow-services~="${target.service}"]`
          : null;
      return [tile, row, overflow].filter((selector): selector is string => selector !== null);
    }
    case 'proposal': {
      return [
        attribute('data-testid', `proposal-${target.proposalId}`),
        attribute('data-proposal-service', target.service),
      ].filter((selector): selector is string => selector !== null);
    }
  }
}

/** The profile field a preference fills, by the same two routes the panel uses. */
function fieldIdFor(preference: {
  fieldId?: string | null;
  category: Parameters<typeof resolveField>[0];
  key: string;
}): string | undefined {
  const direct = resolveByFieldId(preference.fieldId);
  if (direct) return direct;
  return resolveField(preference.category, preference.key) ?? undefined;
}

/**
 * What this event put on screen.
 *
 * Returns empty for the events that produced no element of their own —
 * `typing_start`/`typing_stop` are the reply *arriving*, not the reply, and
 * `connection_status` is about the socket. They still earn a feed row; pointing
 * at one simply glows nothing, which is honest.
 */
export function glowTargetsForEvent(observed: ObservedWsEvent): readonly GlowTarget[] {
  const { event } = observed;

  switch (event.type) {
    /*
     * The user's own turn, which is a target for the same reason Valentin's is:
     * it is the message a `Noted` badge hangs under, so "learns something new"
     * and "sends a message" glow the same bubble from two different rows.
     */
    case 'send_message': {
      const id = event.payload?.messageId;
      return typeof id === 'string' ? [{ kind: 'message', messageId: id }] : [];
    }
    case 'agent_message': {
      const id = event.payload?.message?.id;
      return typeof id === 'string' ? [{ kind: 'message', messageId: id }] : [];
    }
    case 'session_init': {
      const id = event.payload?.welcomeMessage?.id;
      return typeof id === 'string' ? [{ kind: 'message', messageId: id }] : [];
    }
    case 'preference_update': {
      const preference = event.payload?.preference;
      if (!preference || typeof preference.id !== 'string') return [];
      /*
       * A seeded row's `sourceMessageId` names a message nobody ever sent, so it
       * carries no badge (`noted-index.ts` filters it for the same reason). Its
       * chip is real, so the target keeps the field and drops the anchor.
       */
      const sourceMessageId =
        preference.sourceMessageId && preference.sourceMessageId !== DEMO_SEED_SOURCE_MESSAGE_ID
          ? preference.sourceMessageId
          : undefined;
      return [
        {
          kind: 'preference',
          preferenceId: preference.id,
          sourceMessageId,
          fieldId: fieldIdFor(preference),
        },
      ];
    }
    case 'action_proposal': {
      const { proposalId, service } = event.payload ?? {};
      return typeof proposalId === 'string'
        ? [{ kind: 'proposal', proposalId, service }]
        : [];
    }
    default:
      return [];
  }
}

/**
 * The tool name → integration the tool belongs to, learned from activity frames.
 *
 * Needed because the two halves of a tool call reach the client on different
 * channels and only one of them says which integration it was. `agent_activity`
 * carries `service: 'ontopo'` but is unrouted, so it produces no feed row; the
 * `integration.<service>` span *is* the feed row but the bridge flattens every
 * integration onto `resourceId: 'integrations'` with `service: 'External APIs'`,
 * keeping only the tool name in `operation`.
 *
 * So the row that exists cannot name its integration, and the frame that can
 * name it has no row. Joining them on the tool name recovers it without a server
 * change and without adding rows to the feed — `agent_activity` arrives several
 * times per turn and was deliberately folded into the reply beat rather than
 * given beats of its own (`EVENT_STORY`).
 */
export type ToolServiceLookup = ReadonlyMap<string, string>;

/** Record a tool→service pair if this frame is one of the two tool halves. */
export function learnToolService(
  lookup: Map<string, string>,
  payload: AgentActivityPayload | undefined,
): void {
  if (!payload) return;
  if (payload.kind !== 'tool_start' && payload.kind !== 'tool_end') return;
  if (typeof payload.tool !== 'string' || typeof payload.service !== 'string') return;
  lookup.set(payload.tool, payload.service);
}

/**
 * Resource ids whose spans are an outbound integration call.
 *
 * Engine A routes them to `integrations`; on engine B the same call arrives
 * through the Gateway and is served by the tool Lambda. All three are the same
 * beat in the story — a call out to somebody else's API — so all three resolve to
 * a tool target.
 *
 * Keep this in step with the `'asks the outside world'` entries of `SPAN_ACTION`
 * in `use-live-architecture.ts`: those decide which rows the feed captions as an
 * outbound call, and this decides which of them can say who they called. A node
 * renamed in one and not the other is a row that reads as a tool call and glows
 * nothing — which is why `ac-integrations` is not here any more.
 */
const INTEGRATION_RESOURCE_IDS: ReadonlySet<string> = new Set([
  'integrations',
  'ac-gateway',
  'ac-lambda-tools',
]);

/**
 * What this span put on screen.
 *
 * Only integration spans have an answer. A Bedrock or DynamoDB span is work with
 * no element of its own: the *event* that followed it is what mounted something,
 * and that event is a separate beat in the same group — so clicking the group
 * still glows the reply, via the `agent_message` row beside this one.
 */
export function glowTargetsForSpan(
  span: AwsSpan,
  resourceId: string,
  lookup: ToolServiceLookup,
): readonly GlowTarget[] {
  if (!INTEGRATION_RESOURCE_IDS.has(resourceId)) return [];
  const service = lookup.get(span.operation);
  return service ? [{ kind: 'tool', service }] : [];
}
