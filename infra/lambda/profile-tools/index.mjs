/**
 * The three profile tools AgentCore Gateway exposes to engine B, over the same
 * DynamoDB table engine A writes.
 *
 * ## Why a Lambda and not a direct table read from the agent
 *
 * The point of engine B is to let *AgentCore* own the parts Valentin currently
 * hand-rolls. Gateway's job in that story is tool hosting: it turns these three
 * functions into MCP tools, handles the JWT, and hands the agent a tool list it
 * did not have to describe. A Strands agent talking to DynamoDB directly would
 * skip Gateway entirely and there would be nothing to compare.
 *
 * ## Key layout
 *
 * Mirrors `src/server/persistence/keys.ts` exactly — that file is the schema of
 * record and this is a second reader of it, not a second definition of it:
 *
 *   pk = USER#<sub>#SESSION#<sid>
 *   sk = META  |  MSG#<ts>#<id>  |  PREF#<category>#<key>
 *
 * Any change there must be made here in the same commit. There is no shared
 * module to import: this file ships as a plain-asset Lambda so the stack needs
 * no bundler, and the server's TypeScript never reaches the Lambda runtime.
 *
 * ## How the tool name arrives
 *
 * Gateway does not put the tool name in the event. It puts it in the client
 * context, prefixed with the target name and a triple underscore:
 *
 *   context.clientContext.custom.bedrockAgentCoreToolName
 *     === 'valentin-profile___save_preference'
 *
 * The event body is the tool's input object and nothing else.
 *
 * ## On `user_id` being an input rather than a claim
 *
 * The JWT on the Gateway call belongs to a *machine* client, so it carries no
 * end-user identity; the caller has to name the user. That is a real trust
 * boundary and it is worth stating plainly rather than dressing up: this Lambda
 * trusts its caller to have authenticated the user. The chain that makes that
 * safe is that nothing browser-reachable can call it — the proxy service
 * authenticates the Cognito user and derives `storageId` itself, invokes the
 * Runtime with SigV4, and only the Runtime holds a Gateway token. A stolen
 * Gateway token would be able to read any session, which is why the token is
 * short-lived and the client secret never leaves Cognito.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = process.env.VALENTIN_TABLE_NAME;
const PREF_PREFIX = 'PREF#';
const META_SK = 'META';

/**
 * The closed set of categories `src/shared/interfaces/preference.ts` defines.
 *
 * Copied rather than imported, for the same reason the key helpers are: this
 * asset never sees the server's TypeScript. Keep the two in step — a category
 * the union does not contain would write a row the profile UI cannot place.
 */
const CATEGORIES = new Set([
  'food',
  'hobbies',
  'music',
  'travel',
  'gifts',
  'love_language',
  'important_dates',
  'personality_traits',
]);

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

/** Partition key for everything belonging to one session of one user. */
function sessionPk(userId, sessionId) {
  return `USER#${userId}#SESSION#${sessionId}`;
}

/** Sort key of a preference. Category first, so the boundary is unambiguous. */
function prefSk(category, key) {
  return `${PREF_PREFIX}${category}#${key}`;
}

/**
 * Reject anything that would let a caller reach outside the key it named.
 *
 * '#' is the key delimiter, so a session id containing one could address a
 * different partition than the one the arguments describe.
 */
function requireId(name, value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    throw new Error(`${name} must be a non-empty string of at most 128 characters`);
  }
  if (value.includes('#')) {
    throw new Error(`${name} must not contain '#'`);
  }
  return value;
}

/**
 * A user id, which — unlike every other id here — may contain exactly one '#'.
 *
 * A demo visitor's storage id is `<sub>#<visitorId>`: `scopeToVisitor` in
 * `src/server/auth/demo-login.ts` builds it that way so several people sharing
 * the demo account get separate profiles. That id is what engine A keys the
 * partition with, so rejecting it here would make every demo visitor's profile
 * read as empty on engine B — the same data, invisible, with nothing failing.
 *
 * So one '#' is allowed and the character class is otherwise closed. The
 * delimiter argument that {@link requireId} rests on still holds for
 * `session_id`, which keeps the no-'#' rule: with the user half pinned to at
 * most two segments, a caller cannot use it to address a partition other than
 * the one its arguments describe.
 */
const USER_ID_PATTERN = /^[A-Za-z0-9._:-]+(#[A-Za-z0-9._:-]+)?$/;

function requireUserId(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    throw new Error('user_id must be a non-empty string of at most 128 characters');
  }
  if (!USER_ID_PATTERN.test(value)) {
    throw new Error(
      "user_id may contain only letters, digits, '.', '_', ':', '-' and at most one '#'",
    );
  }
  return value;
}

function requireCategory(value) {
  if (!CATEGORIES.has(value)) {
    throw new Error(
      `category must be one of: ${[...CATEGORIES].join(', ')} (got ${JSON.stringify(value)})`,
    );
  }
  return value;
}

/** Every preference row in one session, oldest sort key first. */
async function queryPreferences(userId, sessionId) {
  const items = [];
  let startKey;

  do {
    const page = await doc.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: { ':pk': sessionPk(userId, sessionId), ':prefix': PREF_PREFIX },
        ExclusiveStartKey: startKey,
      }),
    );
    items.push(...(page.Items ?? []));
    startKey = page.LastEvaluatedKey;
  } while (startKey);

  return items;
}

/** Project a stored row down to what a model should see. */
function toPreference(item) {
  return {
    category: item.category,
    key: item.key,
    value: item.value,
    confidence: item.confidence,
    engine: item.engine ?? 'valentin',
    updated_at: item.updatedAt ?? item.timestamp,
  };
}

const tools = {
  /**
   * The whole profile in one call, grouped by category.
   *
   * Grouped rather than flat because this is what gets injected into a prompt:
   * a model reading "food: {...}, gift: {...}" spends fewer tokens and makes
   * fewer category mistakes than one reading forty sibling rows.
   */
  async get_partner_profile(input) {
    const userId = requireUserId(input.user_id);
    const sessionId = requireId('session_id', input.session_id);

    // The partner's name lives on the session meta item, not among the
    // preferences, and it is the one fact the agent needs in every single turn.
    const [meta, items] = await Promise.all([
      doc.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { pk: sessionPk(userId, sessionId), sk: META_SK },
          ProjectionExpression: 'partnerName',
        }),
      ),
      queryPreferences(userId, sessionId),
    ]);

    const byCategory = {};
    for (const item of items) {
      const pref = toPreference(item);
      (byCategory[pref.category] ??= []).push(pref);
    }

    return {
      session_id: sessionId,
      partner_name: meta.Item?.partnerName,
      preference_count: items.length,
      categories: byCategory,
    };
  },

  /**
   * Upsert one preference.
   *
   * `engine: 'agentcore'` is the whole reason this write exists rather than
   * letting AgentCore Memory keep the fact to itself: it tags the row so the
   * comparison can later ask which engine learned what, and it keeps the
   * existing profile UI — which reads this table and knows nothing about
   * Memory — correct for both engines.
   */
  async save_preference(input) {
    const userId = requireUserId(input.user_id);
    const sessionId = requireId('session_id', input.session_id);
    const category = requireCategory(input.category);
    const key = requireId('key', input.key);

    if (typeof input.value !== 'string' || input.value.length === 0) {
      throw new Error('value must be a non-empty string');
    }

    const confidence =
      typeof input.confidence === 'number' && input.confidence >= 0 && input.confidence <= 1
        ? input.confidence
        : 0.8;

    const now = new Date().toISOString();

    await doc.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          pk: sessionPk(userId, sessionId),
          sk: prefSk(category, key),
          sessionId,
          category,
          key,
          value: input.value,
          confidence,
          engine: 'agentcore',
          // No `sourceMessageId`: Memory extracted this from the conversation
          // as a whole, not from one identified message, and inventing an id
          // would make the provenance look stronger than it is.
          source: 'agentcore-memory',
          updatedAt: now,
          timestamp: now,
        },
      }),
    );

    return { saved: true, category, key, confidence };
  },

  /** The flat rows, optionally narrowed to one category. */
  async list_preferences(input) {
    const userId = requireUserId(input.user_id);
    const sessionId = requireId('session_id', input.session_id);
    const category = input.category === undefined ? undefined : requireCategory(input.category);

    const items = await queryPreferences(userId, sessionId);
    const preferences = items
      .map(toPreference)
      .filter((pref) => category === undefined || pref.category === category);

    return { session_id: sessionId, count: preferences.length, preferences };
  },
};

/**
 * Read the tool name out of the Gateway client context.
 *
 * Gateway prefixes it with the target name, so the last `___`-separated segment
 * is the tool. Splitting on the delimiter rather than stripping a known prefix
 * means renaming the target in the stack does not break this file.
 */
function toolNameFrom(context) {
  const raw = context?.clientContext?.custom?.bedrockAgentCoreToolName;
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error(
      'No bedrockAgentCoreToolName in clientContext — this Lambda is only callable through AgentCore Gateway',
    );
  }
  return raw.split('___').pop();
}

export async function handler(event, context) {
  if (!TABLE_NAME) {
    throw new Error('VALENTIN_TABLE_NAME is not set');
  }

  const name = toolNameFrom(context);
  const tool = tools[name];
  if (!tool) {
    throw new Error(`Unknown tool "${name}". Known: ${Object.keys(tools).join(', ')}`);
  }

  // Errors are returned, not thrown, so the agent sees a message it can act on
  // instead of an opaque Gateway 500 it can only retry — a validation failure is
  // information the model can use to fix its own next call.
  try {
    const result = await tool(event ?? {});
    return { ...result, ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ event: 'tool.failed', tool: name, message }));
    return { ok: false, error: message };
  }
}
