# Persistent multi-user Valentin: login page + real conversation history

**Status:** ready to execute. Written to be picked up by the main-app agent once the UI
rebuild settles. Every claim below was verified against the code and the live dev account
at time of writing; line numbers are from `main` at commit `94d23ba`.

## Goal, deliberately narrow

Two things, nothing more:

1. **Many users, each with persistent conversation history** that survives a deploy.
2. **A login page** good enough to demo, plus a one-click preset demo profile.

This is explicitly *not* a production hardening pass. WAF rules, CSP, autoscaling-metric
redesign, MFA, threat protection, and session rename/delete were all cut. They live under
[Deferred](#deferred--reasoning-kept-so-it-isnt-rediscovered) so the reasoning isn't lost.

## Context — why anything is needed at all

Four verified facts:

1. **All state is one container's heap.** `src/server/index.ts:41` constructs
   `new InMemoryStore()` — the only production store construction site. Every deploy
   wipes every conversation, and a second task would split users across disjoint state.
2. **There is no database.** No Valentin table exists in the dev account.
   `Valentin-Data-dev` has **drifted**: it reports `ValentinTable-dev` as
   `CREATE_COMPLETE` while `describe-table` returns `ResourceNotFoundException`. Nothing
   broke when it vanished because no code path ever touched it.
3. **There are no users.** `src/server/persistence/dynamodb-store.ts` hardcodes
   `pk: 'USER#anonymous'` at `:67`, `:175`, `:243`, `:420`. Cognito *is* fully deployed
   (a user pool, the `valentin-dev` domain, and an SPA app client) and **completely
   unwired** — no file under `src/` mentions Cognito, JWT, or login.
4. **The sidebar is a facade.** `src/client/hooks/use-session-store.ts` is
   localStorage-only with its own `uuidv4()` ids, and `session-context.tsx:205`'s
   `updateActiveSession` is **dead code** (declared `:151`, exposed `:237`, never
   invoked), so `StoredSession.messages` is only ever `[]` — **the sidebar's message
   history is already permanently empty today.**

Users and persistence are **one** task, not two: "many users" means the Cognito `sub`
becomes part of the table's partition key. Since no table exists there is a
**zero-migration window** — get the key schema right once, for free. Landing DynamoDB
first with `USER#anonymous` baked in would force a re-migration a week later.

## Decisions

| # | Decision | Consequence |
|---|---|---|
| D1 | **Cognito Hosted UI redirect** | No login form to build — the cheapest real login. Needs `oAuth` config that doesn't exist yet. |
| D2 | **One-click preset demo account** | Fixed pool user, auto-signed-in, profile pre-seeded from the existing 18-preference fixture. |
| D3 | **Partner profile only** | The existing dossier. No user-account entity, no avatar, no multiple partners. |
| D4 | **Login required, demo excepted** | `/api/*` and `/ws` need a JWT. The demo button yields a *real* JWT, so there is one code path downstream. |

## Findings that change an implementation choice

- **The Hosted UI cannot work today.** Probing it returns
  `302 → /error?error=redirect_mismatch`: the app client has **no callback URLs**.
  `infra/lib/auth-stack.ts` sets `authFlows: { userSrp: true }` and no `oAuth` block. So
  D1 needs a CDK change before any client work is even testable.
- **🔴 A live cross-tenant hole that auth alone makes *worse*.**
  `src/server/api/ws-gateway.ts:87` sets `conn.sessionId` from the **client-supplied**
  `payload.sessionId`, and `:33-40` `broadcastToSession` fans out to every connection
  matching it. Add JWT verification without fixing this and you get *authenticated*
  cross-tenant access — worse than none, because it looks secure. It is a ~3-line fix;
  do it in the same PR.
- **A `/callback` route would break.** `infra/lib/cdn-stack.ts:157-164` remaps **only
  404** → `index.html`, and S3-with-OAC returns **403** for a missing key (the OAC policy
  grants only `s3:GetObject`). `/callback` would render raw `AccessDenied` XML. Use the
  **site root** as the redirect URI — there is no router anyway, and this avoids touching
  `cdn-stack.ts` at all.
- **CloudFront strips query strings on `/ws`.** `cdn-stack.ts:117-129` sets only
  `headerBehavior`; `queryStringBehavior` defaults to `none()`. So `?token=` never
  reaches the ALB — hence the auth-frame decision below.
- **`AuthStack` must not read the CloudFront domain.**
  `cdnStack.addStackDependency(computeStack)` (`infra/bin/app.ts:60`) means
  Auth→CDN→Compute→Auth would be a synth-time cycle. Put callback URLs in
  `infra/config/environments.ts` as static strings. (Auth is already constructed before
  Compute, `:39` vs `:45`, so nothing else needs reordering.)
- **No lane-enforcing CI check exists.** `.kiro/skills/shared/scope-check-ci.js` is
  absent and no workflow references `agent:` labels. Ownership lanes are enforced by
  `CONTRIBUTING.md` plus review, **not mechanically**. Required checks are Lint / Unit
  Tests / Build / E2E.
- **Credentials are a prerequisite.** The IAM user used for planning is denied
  `cognito-idp:DescribeUserPoolClient`, `cognito-idp:ListUsers`, and
  `cloudfront:GetDistributionConfig`. Broader — still least-privilege, **not Admin** —
  credentials are needed for the Cognito and deploy steps.

## The key schema — the one decision worth getting right

Put it in a new `src/server/persistence/keys.ts` as pure functions (`sessionPk`,
`META_SK`, `msgSk`, `prefSk`, `userGsi1pk`) with unit tests on the exact strings. Never
build a key inline — four scattered `'USER#anonymous'` literals are what that produces.

| Entity | `pk` | `sk` | `gsi1pk` | `gsi1sk` |
|---|---|---|---|---|
| Session meta | `USER#<sub>#SESSION#<sid>` | `META` | `USER#<sub>` | `TS#<createdAt>#<sid>` |
| Message | `USER#<sub>#SESSION#<sid>` | `MSG#<timestamp>#<msgId>` | — | — |
| Preference | `USER#<sub>#SESSION#<sid>` | `PREF#<category>#<key>` | — | — |

**The `sub` is in the partition key**, which is what makes authorization free: a request
for someone else's session doesn't need a check — it **misses**. `getSession` computes
`USER#<caller-sub>#SESSION#<their-sid>`, no item matches, it returns `null`, and
`http-routes.ts` already maps that to 404. Zero extra reads, and the check **cannot be
forgotten**, because no code path reads a session without naming a user. The alternative
(`pk = SESSION#<sid>` plus an `ownerUserId` attribute compared after the read) costs the
same reads and turns cross-tenant access into a one-missing-`if` bug at every call site.

It also satisfies every access pattern with one query each:

- **Session list:** `Query GSI1 WHERE gsi1pk = USER#<sub>`, `ScanIndexForward: false`,
  `Limit: 50`. Only meta items carry `gsi1pk`, so this is a **sparse index** — one row
  per session — and `ProjectionType.ALL` is already configured.
- **Messages / preferences:** `begins_with(sk, 'MSG#' | 'PREF#')`. `begins_with` is legal
  on a **sort** key; the current blocker at `dynamodb-store.ts:266` is
  `begins_with(gsi1pk, …)` on a **partition** key, which is not — and this schema never
  needs that query at all.
- **`findPreference`:** a plain `GetItem` on a deterministic key. Also makes
  `savePreference` idempotent on its natural key.
- **Reset / delete:** one `Query` + chunked `BatchWriteItem`, since a session's meta,
  messages and preferences share a partition.

Two small deliberate choices:

- **`gsi1sk` uses immutable `createdAt`, not `lastActivity`.** A mutable sort key would
  rewrite the GSI row on every single message just to order a sidebar that
  `session-context.tsx` **already sorts client-side**. Keep `lastActivity` as a plain
  attribute and document the trade in `keys.ts`.
- **Partition per *session*, not per *user*.** This keeps the shared demo account from
  becoming one hot partition holding every demo conversation.

Also: **write the `ttl` attribute.** `infra/lib/data-stack.ts:29` has always configured
TTL and nothing has ever written it. TTL the meta item at the same horizon as its
children or you get orphaned session rows. Note in the PR that TTL deletion is
best-effort within ~48h, so **TTL is hygiene, not the demo reset mechanism**.

### `updatePreference(id, …)` is unimplementable — re-sign it

An `id` alone yields no key; that is exactly why `:266` reaches for an illegal GSI scan,
and why its own comment at `:259` admits "you'd maintain an ID-to-key index."
`storage-interface.ts` lives in `src/server/`, so changing it is lane-safe:

```ts
updatePreference(
  ref: { sessionId: string; category: PreferenceCategory; key: string },
  update: Partial<Pick<Preference, 'value' | 'confidence' | 'sourceMessageId'>>,
): Promise<PreferenceWithHistory>;
```

The natural key *is* the identity. `preference-extractor.ts` already calls
`findPreference(sessionId, category, key)` immediately beforehand, so it has all three in
hand — **confirm that in the extractor body before writing the PR.**

### Scoping: a store factory, not a `userId` parameter

```ts
export interface ScopedStorageFactory {
  forUser(userId: string): StorageInterface;
}
```

Adding `userId` to all 10 methods is mechanical, but it creates ~15 call sites where
passing the **wrong** userId type-checks perfectly and silently writes into another
user's partition. With `forUser` you **cannot obtain a store without naming a user**, so
every method is scoped by construction — the same reasoning as putting `<sub>` in the
`pk`, one layer up. The two reinforce each other: the closure picks the user once,
`keys.ts` bakes it into every key, and there is no third place to get it wrong.

**Cost:** the store stops being a process singleton. Keep `AwsBedrockClient`,
`StubAgentCoreAdapter` and `WsGateway` as singletons; construct the scoped store +
`ConversationMemory` + `PreferenceExtractor` + `AgentOrchestrator` + `EventRouter` per WS
connection and per HTTP request. All four are constructor-only objects, so allocation is
free, and no consumer signature changes — the diff stays in `index.ts`, the two entry
points, and the two stores.

**The test that matters most:** assert `storeA` cannot read anything written via
`storeB`, for `getSession`, `getMessagesBySession`, `getPreferencesBySession`,
`findPreference`, `updateSessionMeta` and `clearSession`. Table-drive it over both
implementations.

## Two tensions, resolved

### WebSocket auth → a first-message auth frame

Browsers cannot set headers on a WS handshake. `?token=` is stripped by the current
origin request policy *and* would put a bearer token in CloudFront/ALB access logs
permanently; `Sec-WebSocket-Protocol` is already allow-listed and works today, but still
lands the token in a logged header.

**Chosen:** accept the upgrade, start the connection `unauthenticated`, and honour
exactly one event — `{ type: 'auth', payload: { token, sessionId? } }`. Anything else
closes with `4401`; a 5s deadline closes with `4408`. This needs **zero `cdn-stack.ts`
changes**, and the token never enters a URL or a logged header. The cost, stated plainly,
is a bounded unauthenticated-socket window — bound it with the deadline and a cap on
concurrent unauthenticated sockets. *Subprotocol smuggling is the documented fallback if
a reviewer insists on rejecting at handshake time.*

### One-click demo vs Hosted UI redirect

Genuinely conflicting: you cannot prefill Cognito's password form, and shipping the demo
password in the SPA bundle makes it public forever.

**Chosen: `POST /api/demo/login`** — the one unauthenticated endpoint. The server reads
demo credentials from Secrets Manager, calls `AdminInitiateAuth`, and returns real
Cognito tokens plus a freshly seeded session id. One click, no redirect, and the tokens
are **indistinguishable from Hosted UI tokens**, so D4's single code path holds. This is
a *credential-vending* endpoint, not an anonymous application path.

Use a **second, server-only app client** (`generateSecret: true`,
`authFlows: { adminUserPassword: true }`, `disableOAuth: true`) so the public SPA client
stays PKCE-only with no password flow at all. **Don't miss the consequence:** demo tokens
carry a different `client_id`, so the verifier needs `clientId: [spa, demo]` — a
single-value `clientId` silently 401s every demo user and will look like an endpoint bug.
It also yields `isDemo` for free (`payload.client_id === demoClientId`), with no `sub`
plumbing.

For demo cleanliness, **reap sessions older than 30 minutes** rather than deleting all —
otherwise two people clicking "Try the demo" seconds apart wipe each other
mid-conversation, at the worst possible moment.

## Execution — 6 PRs

Lane labels per `CONTRIBUTING.md` (review-enforced; there is no CI gate).

### PR 1 — `agent: infra` — make the table and the login endpoint exist

- **`infra/lib/auth-stack.ts`**: add
  `oAuth { flows: { authorizationCodeGrant: true, implicitCodeGrant: false }, scopes: [OPENID], callbackUrls, logoutUrls }`,
  `enableTokenRevocation: true`, and the demo server client. **Do not request
  `aws.cognito.signin.user.admin`** — it would let a stolen access token call
  `UpdateUserAttributes`/`ChangePassword` on the pool. Add a `valentin/<env>/demo-user`
  secret via `generateSecretString`.
- **`infra/config/environments.ts`**: add `appUrls: { callback, logout }` as static
  config — this is what breaks the stack cycle. Callbacks are `http://localhost:5173/`
  and `https://<cf-domain>/`, i.e. the **root path**, per the 403 finding.
- **`infra/lib/compute-stack.ts`**:
  - `:105-110` currently **grants nothing** — `dynamodb:TableName` is not a supported
    DynamoDB IAM condition key, so the `StringLike` never matches. Replace with real
    table ARNs including `/index/*` for GSI1.
  - `:166` — `DYNAMO_TABLE_NAME` is the wrong hardcoded `valentin-sessions-${env}`
    (verified against the live task definition). Point it at the real table name.
  - Add `COGNITO_*` and `DEMO_SECRET_ARN` env vars, and grant
    `cognito-idp:AdminInitiateAuth` scoped to the pool ARN. The existing
    `secretsmanager:GetSecretValue` grant on `valentin/${env}/*` (`:148-149`) already
    covers the demo secret.
- **Repair the Data-stack drift.** Run `detect-stack-drift` on `Valentin-Data-dev`
  **first**, to learn why the table vanished, then deploy so the table exists.
  `RemovalPolicy.DESTROY` at `data-stack.ts:30-32` is the likely enabler — switch to
  `RETAIN` now that it will hold real user data.
- **`scripts/seed-demo-user.sh`** (new): `admin-create-user --message-action SUPPRESS` +
  `admin-set-user-password --permanent`, idempotent (tolerate `UsernameExistsException`).
  A script rather than a custom resource, so no Lambda holds pool-admin rights. It won't
  self-heal, so assert demo-user existence in `scripts/smoke-test.ts`.
- **`scripts/deploy.sh:37`**: one line — per-stack `--exclusively` instead of
  `cdk deploy --all`, so deploying can't stomp work in flight on other branches.
- **Deps**: `aws-jwt-verify`, `@aws-sdk/client-cognito-identity-provider`,
  `@aws-sdk/client-secrets-manager`.
- **Don't split** the `oAuth` block from `appUrls` (synth fails without callback URLs), or
  the compute env vars from the `infra/bin/app.ts` prop wiring.

### PR 2 — `agent: backend-dev` — user-scoped store, and swap it in

New `keys.ts` (plus exact-string tests). Re-sign `updatePreference`; add `listSessions`,
`updateSessionMeta`, `savePreferencesBatch`, and `ScopedStorageFactory` to
`storage-interface.ts`.

Rewrite `dynamodb-store.ts` against the schema. This **removes rather than patches**:

- the `:262-273` illegal `begins_with` on a partition key, and the contradictory
  unfinished comments at `:275-278`;
- the `:226-233` preference overwrite — a plain `PutCommand` on
  `PREF#<category>#<key>` destroyed `history` while `:240-247` still incremented the
  counter;
- the counter-on-missing-item bugs at `:172-179` and `:240-247`
  (`SET messageCount = messageCount + :inc` throws when the attribute is absent — use
  `ADD` or `if_not_exists`);
- the dead first `GetCommand` in `getSession`.

Also add `attribute_exists` guards so `endSession` honours the documented "no-op for
unknown session ids" (`storage-interface.ts:51`); **paginate every Query via
`LastEvaluatedKey`** (today `clearSession` can report success while leaving data beyond
the 1 MB page); and write `ttl`.

Fix `InMemoryStore`'s own bug too — it keys preferences by a fresh uuid (`:40`), so
`findPreference` (`:84-93`) returns the *oldest* duplicate.

Then `index.ts:41` → `deps.store ?? createStore()` with
`export interface ServerDeps { store?: ScopedStorageFactory }`, DynamoDB in production
and memory otherwise. **Injection is mandatory:**
`src/server/__tests__/index.test.ts` calls `createServer()` in 8 tests and 3 exercise
storage for real — without injection `npm test` makes live AWS calls, failing without
credentials or writing junk into the real table with them. Defaulting to memory means
those 8 call sites need no edit.

⚠️ **Highest conflict risk in this plan.** Don't run it in parallel with any separate
`dynamodb-store.ts` repair — merge that first or fold it in here.

⚠️ The existing 445-line `dynamodb-store.test.ts` is a `vi.fn()` shape mock that asserts
which commands get *built*, never what DynamoDB would *accept* — which is precisely why
every defect listed above is green today. It needs rewriting alongside the store; a
handful of tests against DynamoDB Local covering read-your-write and cross-user isolation
are worth more than the whole existing file.

### PR 3 — `agent: backend-dev` — JWT verification, WS auth frame, tenant hole

**First, extract the shared entry-point code.** `prod-server.ts` and `dev-server.ts`
duplicate the entire route table and WS block, and have **already drifted** — prod has
request ids, structured logging and graceful shutdown; dev doesn't; their `/api/health`
shapes differ. Pull out `createExpressApp(deps)` and `attachWebSocket(server, deps)`
into `src/server/api/http-app.ts` and `ws-server.ts`, or accept three rounds of
copy-paste in this PR alone.

- **`src/server/auth/jwt-verifier.ts`** using **`aws-jwt-verify`** — AWS's own library,
  zero dependencies, and it encodes the Cognito checks that are easy to forget
  (`token_use === 'access'`, `client_id` allow-list, `iss`, JWKS caching). With `jose`
  you hand-write all of that and the failure mode is silently accepting an ID token or
  another client's token. Verify the **access** token; `payload.sub` is the user id; the
  ID token is never consumed.
- `app.use('/api', requireAuth)` registered **after** `/api/health` and **after**
  `POST /api/demo/login`. **`/api/health` must stay open** — `compute-stack.ts` uses it
  for both the container health check and the ALB target group, neither of which can
  present a JWT. Miss this and tasks never pass health checks and ECS rolls back in a
  loop.
- **`dev-bypass-verifier.ts`**: if `COGNITO_USER_POOL_ID` is unset **and**
  `NODE_ENV !== 'production'`, accept anything and log loudly. In production, missing
  Cognito config is a **hard boot failure** — fail closed. This is what keeps `npm test`,
  `smoke-test` and all of `e2e/tests/*` green with **zero test edits**, since
  `playwright.config.ts` boots `dev-server.ts` with no Cognito env.
  Contain the client-side twin (`VITE_AUTH_DISABLED`) three ways: read it only via
  `import.meta.env` so Vite dead-code-eliminates the branch; set it in
  `.env.development` only; and grep `dist/assets/*.js` for a sentinel after
  `vite build`, failing the deploy if found. Only the third actually prevents the
  mistake.
- **`ws-gateway.ts` — close the tenant hole.** Delete the
  `conn.sessionId = payload.sessionId` assignment at `:87`. `conn.sessionId` becomes
  **server-set only**, assigned once after the server confirms ownership; `send_message`
  then *validates* `payload.sessionId === conn.sessionId`. Given that,
  `broadcastToSession` is safe with no owner check — the invariant holds by construction
  rather than by remembering to check. Comment it as such. Add `userId` and `exp` to
  `WsConnection`.
- **`event-router.ts`**: `routeEvent(type, payload, auth)`; a per-session message cap for
  `isDemo` callers.
- **Move `orchestrator.initSession()`** out of `wss.on('connection')`
  (`prod-server.ts:135`, `dev-server.ts:80`) into the auth handler. Today it mints a new
  session on every connect **and every reconnect**, and `use-websocket.ts` reconnects
  with exponential backoff — so a flaky network silently shreds history into orphaned
  sessions. On resume, a `getSession` hit **is** the ownership proof; a miss returns
  `SESSION_NOT_FOUND` and **must not silently mint a new session** (silent minting is
  what makes the current bug invisible). Reuse the existing `session_init` event rather
  than adding a `session_resumed` one.
- **`src/shared/interfaces/ws-events.ts`**: add `auth` to `ClientEvent` and `auth_ok` to
  `ServerEvent`. **Purely additive** — zero edits to existing members — so it cannot
  conflict with the in-flight client refactor. This is the only `src/shared/` change in
  the plan.
- **Token expiry**: record `exp` at auth; on each `send_message`, if expired, close
  `4401` and let the client refresh and reconnect with the same `sessionId`. No timers,
  no mid-turn kills — and ordinary hourly use then exercises the resume path.
- **Don't split** the state machine from the `initSession` relocation — a half-landed
  state machine is an auth bypass.

### PR 4 — `agent: backend-dev` — session list + demo login

- `GET /api/sessions` (one GSI1 query) and `GET /api/session/:id` — **the latter is what
  actually makes the sidebar work.** Keep `POST /api/session/seed` and
  `GET /api/session/:id/preferences` (both asserted by
  `src/server/api/__tests__/http-routes.test.ts` and driven by `DemoToolbar` and
  `rehearsal.mjs`); they simply become caller-scoped. Keep registering `/session/seed`
  before any `/session/:id` pattern so the literal `seed` can never be captured as a
  session id.
- **`demo-login.ts`**: `AdminInitiateAuth` → reap sessions >30min → create + seed →
  return tokens + sessionId, behind a simple in-process token bucket. The demo's real
  risk is Bedrock cost, not privacy.
- **Batch the seed.** `seedDemoProfile` awaits `savePreference` per fixture, and each is
  a `Put` **plus** an `Update` counter — **36 sequential round trips**, 1–2s on the
  demo's most visible click. Use one `BatchWriteItem` (18 items, under the 25 limit) plus
  one counter `Update`.
- **Denormalise `partnerName`** onto the session meta item when a `partner_name`
  preference is written, so `SessionEntry.tsx:130` finally shows something useful.
  Nothing else writes it today — `PartnerProfilePanel.tsx:150-151` derives it live from
  the preference and never writes back.
- Every category+key in `src/server/fixtures/demo-profile.ts` must keep matching
  `src/client/utils/profile-field-registry.ts` verbatim or the field silently vanishes
  from the panel. The registry-coverage tests in `http-routes.test.ts` fail on drift —
  keep them passing.

### PR 5 — `agent: frontend` — AuthProvider, login screen, demo button

Hand-roll PKCE in `src/client/auth/cognito-oauth.ts` (~150 lines over four Cognito URLs)
rather than adding Amplify: the repo has 8 production dependencies and a deliberate
no-framework posture, and Amplify's Hosted UI helper wants to own a redirect lifecycle
that fights the server-vended demo tokens. `oidc-client-ts` is the honest runner-up and
the documented fallback; it loses because its headline silent-renew-via-iframe breaks
under third-party-cookie blocking (so we'd use `refresh_token` anyway) and it assumes a
callback *route* that a router-less app has to bend around.

Because it's hand-rolled, **list these in the PR description so review can tick them
off**:

- `state`: 32 random bytes in `sessionStorage`, compared then deleted; on mismatch abort
  **without** exchanging the code.
- `code_verifier`: single-use, S256 via `crypto.subtle` (needs a secure context —
  localhost qualifies, a LAN IP does not).
- **Single-flight refresh**: a module-level `Promise | null`, or ten concurrent 401s burn
  the refresh token.
- 60s clock-skew margin.
- No ID token, therefore no `nonce` — say so explicitly rather than leaving it looking
  forgotten.

**Callback at the site root**, detected with `URLSearchParams` in a mount effect, then
`history.replaceState` (not `pushState`) so the code never enters history. Guard React
19's StrictMode double-effect by consuming the verifier from `sessionStorage`
read-then-delete *before* the fetch, plus an in-module in-flight flag.

`AuthProvider` goes inside `ErrorBoundary`, above `SessionProvider` (`App.tsx:116-128`),
and **renders children only once authenticated** — so `SessionProvider` never mounts
without a token, `use-websocket` needs no wait-for-auth state machine, and logout
unmounts the subtree, discarding all in-memory state for free.

Token storage: access token **in memory only**; refresh token in **`sessionStorage`**,
not `localStorage` — not shared across tabs, cleared on tab close, so a shared browser
doesn't leave a 30-day refresh token behind. Call `POST /oauth2/revoke` on logout, not
just a local clear, or "sign out" is cosmetic. Be clear-eyed about the residual: with a
refresh token in web storage, XSS means account takeover for up to 30 days — which is why
the deferred CSP item is the highest-leverage follow-up.

⚠️ `use-websocket.ts` is the highest-collision file in this plan — check with the rebuild
session before starting.

### PR 6 — `agent: frontend` — sidebar off localStorage

New `src/client/utils/session-api.ts`. In `session-context.tsx`: async load on mount, an
additive `loading` flag, delete the persist-on-every-change effect, `createSession`
returns a `Promise`, `switchSession` fetches detail.

**Keep all nine action types**, so `SessionSidebar.tsx` and `SessionEntry.tsx` need no
changes (`SessionSidebar.tsx:167` discards `createSession()`'s result — just add a
`.catch()`). Keep sidebar-collapsed state in localStorage; it's a UI preference, not user
data. Either wire up or delete `updateActiveSession` — don't leave dead code.

**On first login, discard local sessions with a one-time notice** rather than building an
import endpoint: per finding 4 they contain no message history at all, and an import
endpoint is real surface area (a bulk write of client-supplied preference rows bypassing
the extractor). *If you disagree, the fallback is a capped, registry-validated
`POST /api/sessions/import` — worth escalating rather than deciding silently.*

Finally, add the demo click to `rehearsal.mjs` before step 1, leaving its five assertion
groups intact, so the rehearsal exercises the path an audience actually takes. (Note:
that file sits at the repo root, outside every lane in `CONTRIBUTING.md` — confirm
ownership.)

### Deploy note

PRs 3, 5 and 6 may merge to `main` separately — the dev bypass keeps CI green — but they
must reach **production together**. Any one of them alone in production is either a
broken app or an unauthenticated one.

## Verification

Run only when other sessions' dev servers are down; they hold ports 3001 and 5173, which
`playwright.config.ts` auto-starts.

1. `npm run lint` (`tsc --noEmit`) and `npm test`.
2. `cd infra && npx cdk synth --context env=dev` — this is what catches the stack cycle.
3. `aws dynamodb describe-table --table-name <table>` finally succeeds.
4. **Hosted UI**: the `redirect_mismatch` probe now reaches a real login page, and
   `describe-user-pool-client` confirms implicit grant is off.
5. **Auth gate**: `/api/session` unauthenticated → 401, with a token → 201.
   `/api/health` still returns 200 unauthenticated (the ALB depends on it).
6. **🔴 Cross-tenant isolation, both directions** — the security claim:
   (a) user B requesting A's `sessionId` over HTTP gets 404, not A's data;
   (b) user B **cannot bind a WebSocket to A's session** and receive A's agent output.
   (b) is the bug that exists today, and (a) will not catch it.
7. **Persistence — the actual objective.** Log in as two different users, hold a
   conversation as each, then `aws ecs update-service --force-new-deployment`. Both
   histories come back, separately. This is the test that fails today and is the entire
   point of the work. Extend it by scaling to 2 tasks and confirming a session survives
   being served by either.
8. **Revision path**: state a preference, then revise it — it persists with `history`
   intact instead of throwing `ValidationException`.
9. **One-click demo**: 18/18 preferences render, and a second click yields a clean
   session without disturbing a concurrent one.
10. **Reconnect**: kill the socket mid-conversation — history survives instead of a new
    session being minted.
11. `npx playwright test` (green via the dev bypass, zero test edits) and
    `node rehearsal.mjs`; then confirm `/api/health` is healthy through CloudFront
    post-deploy.

## Prerequisites and cautions

- **Credentials.** The planning identity lacks `cognito-idp:DescribeUserPoolClient`,
  `cognito-idp:ListUsers` and `cloudfront:GetDistributionConfig`. PR 1 and the deploy
  need broader — still least-privilege, **not Admin** — credentials. Do not silently
  escalate.
- **Confirm before any action that could drop the table again**, and check
  `RemovalPolicy` before deploying `Valentin-Data-dev`.
- **Secrets never enter git or logs.** The demo password lives only in Secrets Manager,
  and never in the SPA bundle.
- **`docs/refactor-plan.json` is immutable** — committed stages are never edited; changes
  append to `revisions` (currently `[]`, hard-asserted by
  `refactor-plan.test.ts:238-240`).
- **Collisions.** In-flight frontend branches touch **zero** files under `src/server/` or
  `infra/`, so file-level risk is nil. The real vectors are the shared
  `cdk deploy --all` (PR 1 fixes it), ports 3001/5173, and `use-websocket.ts` /
  `session-context.tsx` / `App.tsx` — all three central to PRs 5–6. **Ask whether the
  in-flight rebuild is already changing those three before starting.**

## Open questions for whoever executes

1. **The deployed SPA client's real `AllowedOAuthFlows`.** CDK applies OAuth *defaults*
   when `oAuth` is omitted, so **implicit grant may be live right now**. Needs
   `describe-user-pool-client`, which the planning credentials couldn't call. If it is
   on, turning it off is a security fix, not a tidy-up.
2. **The demo app-client secret → Secrets Manager path.** `userPoolClientSecret` is a
   `SecretValue` but `ecs.Secret.fromSecretsManager` wants a `Secret`. The proposed
   escape — having the seed script write it to `valentin/<env>/demo-client` — is
   untested. **Do not let it fall back to a plaintext env var.**
3. **`preference-extractor.ts`'s exact call pattern** around `findPreference` /
   `updatePreference`. The re-signature assumes category+key are in hand at the update
   site.
4. Whether the drifted `Valentin-Data-dev` will create cleanly or needs a stack-level
   repair outside this plan.

## Deferred — reasoning kept so it isn't rediscovered

- **Autoscaling.** Currently `scaleOnCpuUtilization` (`compute-stack.ts:232-241`), which
  is the wrong signal: a turn is ~412ms of Bedrock I/O out of ~450ms, so the event loop
  saturates while CPU sits idle. Connections-per-task (a `MathExpression` over
  `ActiveConnectionCount` ÷ running tasks) is the right metric, with CPU as a floor.
  **`ALBRequestCountPerTarget` is not viable** — a client sends one upgrade and then
  carries the whole conversation over the socket, so a saturated task and an idle one
  report identical counts. Also not raised here: `desiredCount: 1` and the 256/512 task
  size.
- **CSP / response-headers policy.** The highest-leverage mitigation for the
  refresh-token-in-web-storage risk, so revisit this the moment real users' data is
  involved. Two honest constraints when you do: `main.tsx` injects a `<style>` tag and
  every component uses inline `React.CSSProperties`, so **`style-src 'unsafe-inline'` is
  unavoidable** for a static SPA that can't mint a per-response nonce; and `index.html`
  loads Google Fonts, so `style-src`/`font-src` need entries. *Target state:* because
  `/api/*` is a behaviour on the **same** CloudFront distribution as the SPA (and uses
  `ALL_VIEWER`, which forwards cookies), a BFF-style `Secure; HttpOnly; SameSite`
  refresh cookie is achievable here — but moving to a cookie makes **CSRF live**, needing
  `SameSite=Strict` plus a double-submit token.
- **WAF rate rule on `/api/demo/login`** (~10 per 5 min per IP). The blanket 2000/IP is
  far too loose for an unauthenticated endpoint that writes and calls Cognito.
- **Cognito hardening**: MFA; threat protection (`AUDIT` minimum, `ENFORCED` for
  compromised-credential blocking — a **paid per-MAU** feature, so a cost decision); a
  signup allowlist, since `selfSignUpEnabled: true` + `autoVerify.email` lets anyone
  create unlimited accounts and the WAF can't stop it because each is a legitimate user;
  demo-password rotation; `passwordPolicy.minLength` 8→12. Note
  `preventUserExistenceErrors: true` is correct but only hides enumeration — it does
  nothing against credential stuffing.
- **Two facts worth carrying forward.** The Hosted UI is served from an AWS-owned
  `*.auth.<region>.amazoncognito.com` domain, so our CloudFront WAF **never sees a single
  login attempt** — only Cognito's own throttling protects the login form. And the ALB is
  `internetFacing: true`, so it's directly reachable if someone resolves its DNS name,
  where the JWT check is the only gate.
- **Smaller items**: session rename/delete endpoints; `403 → /index.html` in
  `errorResponses`; a scheduled (not per-PR) Playwright spec driving the real Hosted UI;
  HTTPS on the ALB listener (`compute-stack.ts:212` — CloudFront→ALB is plaintext; needs
  ACM plus a domain); the orphaned `valentin-frontend-${env}` bucket
  (`data-stack.ts:67` — the real bucket is `valentin-static-${env}`).
- **Cross-task WebSocket fan-out.** `broadcastToSession` iterates only local
  connections. Latent, not broken: the task holding a socket is the task producing its
  events, and ALB stickiness pins it. Breaks only on multi-device.
- **Data classification.** The dossier holds names, dates and intimate preferences,
  stored as plaintext attributes under AWS-managed SSE. A real product would classify
  that as sensitive personal data and consider field-level encryption. Add a visible
  "shared public demo — do not enter anything real" banner in the meantime.
- **Out of scope by decision (D3):** user account profiles, and multiple partners per
  user.
