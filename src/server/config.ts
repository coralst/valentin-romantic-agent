export const config = {
  dynamoTableName: process.env.DYNAMO_TABLE_NAME ?? 'ValentinTable-dev',
  s3PhotoBucket: process.env.S3_PHOTO_BUCKET ?? 'valentin-photos-dev',
  bedrockGuardrailId: process.env.BEDROCK_GUARDRAIL_ID,
  bedrockGuardrailVersion: process.env.BEDROCK_GUARDRAIL_VERSION ?? 'DRAFT',
  awsRegion: process.env.AWS_REGION ?? 'us-east-1',
  bedrockModelId: process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3001', 10),

  /**
   * Where the app is reachable from, for links in outbound mail.
   *
   * `integrations/google/oauth.ts` already reads this variable directly; this is
   * the same value with a name, so a reminder and an OAuth callback cannot
   * disagree about which host the user is on. It falls back rather than throwing
   * because a wrong origin costs a dead link in a mail, not a failed send.
   */
  publicOrigin: process.env.PUBLIC_ORIGIN ?? 'http://localhost:5173',

  /**
   * The key that signs shareable-conversation links.
   *
   * Deliberately optional and deliberately undefaulted. `sharing/share-token.ts`
   * falls back to a per-process random key and warns once, which means links break
   * across a restart or a second container; a hardcoded default here would instead
   * mean links **forgeable by anyone holding this repository**, since a share token
   * is the one credential in the system that names its own owner. Breaking is the
   * safe direction — see that file's header for the full argument.
   */
  shareTokenSecret: process.env.SHARE_TOKEN_SECRET,

  /**
   * The reminder sweeper.
   *
   * A minute is far finer than the hour `dueAt` is pinned to, so a late sweep is
   * never visible to the reader. `REMINDERS_ENABLED=false` stops the timer without
   * removing the rows, for a demo where nothing should leave the building.
   */
  reminders: {
    enabled: process.env.REMINDERS_ENABLED !== 'false',
    channel: process.env.REMINDER_CHANNEL ?? 'log',
    intervalMs: parseInt(process.env.REMINDER_INTERVAL_MS ?? '60000', 10),
  },

  /**
   * Cognito wiring, all supplied by compute-stack.ts.
   *
   * Deliberately optional: with `userPoolId` unset the server falls back to the
   * dev-bypass verifier, which is what keeps `npm test`, Playwright and a bare
   * `npm run dev:server` working without an AWS account. In production the same
   * absence is a hard boot failure — see auth/token-verifier.ts.
   */
  cognito: {
    userPoolId: process.env.COGNITO_USER_POOL_ID,
    /** The public SPA client: PKCE only, no password flow. */
    spaClientId: process.env.COGNITO_SPA_CLIENT_ID,
    /** The server-only client behind POST /api/demo/login. */
    demoClientId: process.env.COGNITO_DEMO_CLIENT_ID,
    demoSecretArn: process.env.DEMO_SECRET_ARN,
    /**
     * Hosted UI origin, e.g. `https://valentin-dev.auth.us-east-1.amazoncognito.com`.
     *
     * Handed to the browser by `GET /api/config` rather than baked into the
     * bundle at build time, so the SPA needs no AWS configuration of its own.
     */
    domain: process.env.COGNITO_DOMAIN,
  },

  /**
   * Credentials for the outside world.
   *
   * Every field is optional, and that is the contract: `buildToolRegistry` only
   * registers a tool whose credentials are actually present, so the server boots
   * and the conversation works with none of these set. An integration that is
   * not configured is absent from the model's tool list rather than present and
   * failing, which is the difference between "Valentin cannot book tables yet"
   * and "Valentin tried to book a table and broke".
   *
   * Hebcal needs nothing — it is a local calculation, so it is always available.
   */
  integrations: {
    /**
     * Amadeus Self-Service. `host` stays on the test sandbox unless someone
     * deliberately points it at production, because the booking endpoints spend
     * real money.
     */
    amadeusClientId: process.env.AMADEUS_CLIENT_ID,
    amadeusClientSecret: process.env.AMADEUS_CLIENT_SECRET,
    amadeusHost: process.env.AMADEUS_HOST ?? 'test.api.amadeus.com',

    /**
     * One Google account, hardcoded — this build has no per-user OAuth, so
     * Calendar and Gmail act as the account whose refresh token is set here.
     */
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
    googleRefreshToken: process.env.GOOGLE_REFRESH_TOKEN,

    /**
     * Google Maps Platform: geocoding and Nearby Search.
     *
     * Deliberately *not* injected as an ECS secret the way the OAuth trio is.
     * `ecs.Secret.fromSecretsManager` fails **task startup** when the JSON key it
     * names is absent, so a Maps key that had not been populated yet would take
     * the whole app down instead of merely disabling place search. Passing the
     * secret's ARN as a plain env var and reading it at runtime — the
     * `DEMO_SECRET_ARN` pattern — makes absence degrade to "Places not
     * configured", which is the failure this integration should have.
     */
    googlePlacesApiKey: process.env.GOOGLE_PLACES_API_KEY,
    googlePlacesSecretArn: process.env.GOOGLE_PLACES_SECRET_ARN,

    /**
     * Spotify Web API — the playlist Valentin builds for the drive there.
     *
     * Two credentials do two different jobs, and the split is why this
     * integration is useful before anyone signs in:
     *
     * - `clientId` + `clientSecret` alone buy the *client-credentials* grant,
     *   which can search the catalogue. That is enough to choose real tracks
     *   from her actual taste, so `find_music` works on them alone.
     * - `refreshToken` is a *user* grant, and the only thing that can write a
     *   playlist into somebody's library. Without it, confirming a playlist
     *   hands over Spotify links instead of saving — the same fallback Ontopo
     *   uses when it has no guest identity, and always safe.
     *
     * One account for the whole build, like Google above: a playlist saved here
     * lands in whoever's library minted the refresh token, so this must be a
     * demo account rather than a real person's.
     */
    spotifyClientId: process.env.SPOTIFY_CLIENT_ID,
    spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    spotifyRefreshToken: process.env.SPOTIFY_REFRESH_TOKEN,

    /**
     * Serve the Spotify tools from a local catalogue instead of the network.
     *
     * Off unless explicitly asked for. It exists because the playlist path is
     * the one integration whose *shape* can be demonstrated with no account at
     * all — searching is a pure lookup and a playlist is a list of ids — and
     * because `npm test` and `verify:local` must not depend on Spotify being
     * reachable or on anyone holding keys.
     *
     * It is not a way to make the panel lie. Everything produced in this mode
     * says so in the text the user reads: {@link FIXTURE_NOTICE} is prepended to
     * every proposal summary and tool result, so a confirmed playlist in fixture
     * mode reads "nothing was sent to Spotify" rather than claiming a save. If
     * you find yourself wanting the notice gone, what you want is credentials.
     */
    spotifyFixture: process.env.SPOTIFY_FIXTURE === '1',

    /** WhatsApp Cloud API, via the Graph endpoint for one phone number id. */
    whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    whatsappToken: process.env.WHATSAPP_TOKEN,

    /**
     * Who the table is booked for, when Ontopo's checkout is completed here.
     *
     * Ontopo has no booking API: the last step is a two-page web form asking for a
     * name, an email and a phone. So finishing a reservation on the server means
     * driving that form, and driving it means having someone to put on it.
     *
     * Deliberately not defaulted. A reservation carries a real obligation to a real
     * restaurant, and an invented phone number is worse than no booking at all —
     * the restaurant cannot reach the guest and the guest never receives the
     * cancellation link, so a change of plan becomes a no-show. With any of these
     * unset, `confirm` falls back to handing over the checkout link, which is the
     * behaviour this integration shipped with and is always safe.
     */
    ontopoGuestFirstName: process.env.ONTOPO_GUEST_FIRST_NAME,
    ontopoGuestLastName: process.env.ONTOPO_GUEST_LAST_NAME,
    ontopoGuestEmail: process.env.ONTOPO_GUEST_EMAIL,
    ontopoGuestPhone: process.env.ONTOPO_GUEST_PHONE,

    /**
     * Escape hatch back to the link handoff, with the guest details still set.
     *
     * Set `ONTOPO_AUTO_COMPLETE=false` to keep the identity configured — the panel
     * and the proof script both read it — while forcing every confirm to stop at a
     * link. Useful for a demo where nobody wants a real table booked, and for
     * bisecting whether a booking failure is the form driver or Ontopo itself.
     */
    ontopoAutoComplete: process.env.ONTOPO_AUTO_COMPLETE !== 'false',
  },

  /**
   * Engine B's managed half, all supplied by compute-stack.ts to the proxy
   * service only.
   *
   * Deliberately optional, for the same reason the Cognito block is: with these
   * unset the server runs engine A and nothing here is read, which is what keeps
   * `npm test` and a bare `npm run dev:server` working without an AWS account.
   * The engine selector treats a missing `runtimeArn` as "engine B is not
   * available here" rather than as a boot failure — see agent/engine.ts.
   */
  agentCore: {
    runtimeArn: process.env.AGENTCORE_RUNTIME_ARN,
    memoryId: process.env.AGENTCORE_MEMORY_ID,
    gatewayUrl: process.env.AGENTCORE_GATEWAY_URL,
  },
};
