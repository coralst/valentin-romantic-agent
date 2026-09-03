# Gmail and Calendar: getting them working locally and on CloudFront

Valentin's `gmail.send` and `calendar.events` tools need three values:

| Value | Where it comes from |
|---|---|
| `GOOGLE_CLIENT_ID` | Google Cloud console, the OAuth client you created |
| `GOOGLE_CLIENT_SECRET` | same client |
| `GOOGLE_REFRESH_TOKEN` | **not** in any console — only Google's consent screen mints it |

The refresh token is the one that matters and the one to be careful with. It
grants *send mail as you* and *write to your calendar* on a real personal
account, it does not expire, and it is bound to the OAuth **client**, not to an
origin. That last point is what makes this whole setup tractable: a token
obtained on `localhost` works verbatim in the deployed task.

**Never** commit any of the three, and never paste one into a chat window. The
only places they belong are `.env` (gitignored) and Secrets Manager.

## One-time console setup

Project [`valentin-tfc`](https://console.cloud.google.com/auth/overview?project=valentin-tfc).

1. Enable the two APIs — nothing works until both say *Enabled*:
   - [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com?project=valentin-tfc)
   - [Google Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com?project=valentin-tfc)
2. [Audience](https://console.cloud.google.com/auth/audience?project=valentin-tfc) →
   keep the app in **Testing**, and add your own Gmail address under **Test users**.
   Leave it in Testing on purpose: `gmail.send` is a *sensitive* scope, so
   clicking **Publish app** sends you into Google's verification review, which
   takes weeks and is not needed for a demo. Testing mode gives a real token
   for a test user immediately; the only cost is the "Google hasn't verified
   this app" interstitial, which you click through via *Advanced → Go to…*.
3. [Clients](https://console.cloud.google.com/auth/clients?project=valentin-tfc) →
   the client must be of type **Web application**. Its two authorised redirect
   URIs must be **exactly** these, full path included, no trailing character:

   ```
   http://localhost:5173/api/integrations/google/callback
   https://d26dwovftfq9oe.cloudfront.net/api/integrations/google/callback
   ```

   Both are needed — Google matches the redirect URI character for character,
   and `http` vs `https` counts as a difference. The CloudFront one is `https`;
   there is no http listener.

## Locally

```bash
AWS_PROFILE=dev-devops-agent AWS_REGION=us-east-1 npx tsx src/server/dev-server.ts   # :3001
npx vite                                                                            # :5173
```

Open the app, then the **integrations** panel in the left rail:

1. On the Gmail or Calendar row, paste the client id and client secret and save.
   These go to `POST /api/integrations/google/connect`, which writes them to
   `.env` — they never travel anywhere else.
2. Click the Google sign-in that appears. The server hands back a consent URL
   (`GET /api/integrations/google/auth-url`), the popup takes you to Google, you
   choose your account and grant the two scopes.
3. Google redirects to `/api/integrations/google/callback`, the server swaps the
   code for a refresh token and writes `GOOGLE_REFRESH_TOKEN` to `.env`. The
   panel rows flip to *live*, and the tools are registered without a restart.

That callback route is the one unauthenticated route under `/api` — deliberately,
because Google performs the navigation and carries no bearer token. It is guarded
instead by a server-minted single-use `state` that expires in ten minutes.

The token exchange **rejects a response with no refresh token**. If you hit that,
it is almost always because you previously granted consent to this client:
Google only returns a refresh token on first consent. Revoke the app at
[myaccount.google.com/permissions](https://myaccount.google.com/permissions) and
connect again.

## On CloudFront

The panel flow cannot be used to configure the deployed app durably. Both
containers run with `readonlyRootFilesystem: true`, so the `.env` write is a
best-effort no-op there — it is logged as `integration.env-persist-failed` and
swallowed, so a connect from the deployed panel appears to work and then
evaporates the next time a Fargate task is replaced. Mid-demo, that looks like
Valentin spontaneously forgetting how to send mail.

Secrets Manager is the durable path. `infra/lib/compute-stack.ts` creates
`valentin/<env>/google-oauth` and injects its three keys into both engine
containers as ECS secrets, so they arrive as ordinary environment variables and
appear in neither the task definition nor `describe-tasks` output.

The secret is created **empty**, so it needs populating once. Read the three
values out of your local `.env` and put them in — from your own terminal, so
they never pass through an agent:

```bash
aws secretsmanager put-secret-value \
  --secret-id valentin/dev/google-oauth \
  --region us-east-1 \
  --secret-string "$(python3 -c '
import json, pathlib
env = dict(
    line.split("=", 1)
    for line in pathlib.Path(".env").read_text().splitlines()
    if line.strip() and not line.startswith("#") and "=" in line
)
print(json.dumps({k: env[k] for k in
    ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN")}))
')"
```

Then deploy the infra change and restart the tasks so they pick the values up:

```bash
bash scripts/deploy.sh dev --scope=infra
for svc in valentin-service-dev valentin-ac-proxy-dev; do
  aws ecs update-service --cluster valentin-cluster-dev --service "$svc" \
    --force-new-deployment --region us-east-1 --no-cli-pager >/dev/null
done
```

Both services, because both engines get the credentials — engine B would
otherwise be the one engine that cannot send mail, which is exactly the kind of
difference the A/B comparison is supposed to attribute to the engine.

`--scope=infra`, not the bare script: a full `deploy.sh` rebuilds the image and
`s3 sync --delete`s the frontend, which clobbers whatever else is deployed.

Order matters slightly. If you populate the secret *before* the first deploy,
CloudFormation will overwrite it with the empty placeholder, because that deploy
is what creates the secret. Deploy first, populate second, force a new
deployment third. Every deploy after that leaves the value alone —
`generateSecretString` only runs at create time.

## Confirming it worked

`GET /api/integrations` returns `configured: true/false` per integration and
never returns a credential, so it is safe to look at:

```bash
curl -s https://d26dwovftfq9oe.cloudfront.net/api/integrations \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

Or just open the panel: the Gmail and Calendar rows read *live* when all three
values are present, and *not connected* when any one is missing. Readiness is a
conjunction of the three, which is why a partial secret shows up as simply
unavailable with no hint about which value is absent — if the rows stay dark
after all this, check that all three keys made it into the secret.
