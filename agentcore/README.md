# Engine B's agent

The container behind the AgentCore Runtime. Engine A is the hand-written Bedrock
pipeline in `src/server/agent/`; this is the same conversation run through
AgentCore Runtime, Memory, Gateway and Observability, so that a measured
difference between the two is attributable to the platform rather than to two
different agents.

It is deployed by `scripts/deploy.sh` and wired by `infra/lib/agentcore-stack.ts`.
Nothing here is imported by the Node app — the only link between the two is the
JSON contract below.

## The contract

`InvokeAgentRuntime` posts to `/invocations`. Request:

```json
{
  "prompt": "...",
  "system_prompt": "...",
  "session_id": "...",
  "actor_id": "<cognito sub>",
  "memory_id": "...",
  "history": [{ "role": "user" | "assistant", "content": "..." }]
}
```

Response:

```json
{ "content": "...", "tools_used": ["get_partner_profile"], "error": "optional" }
```

`content` is the one field the caller cannot do without —
`parseRuntimeReply` in `src/server/agent/agentcore-adapter.ts` is tolerant about
everything else, because the proxy image and this image carry separate tags and a
rolling deploy always has a window where one is newer than the other. A failed
turn comes back as a 200 with an empty `content` and an `error` string rather than
a 5xx, so the cause lands in the log group instead of the Runtime's generic error
page.

## Three things that will bite

**ARM64 only.** The Runtime accepts an amd64 image at deploy time and then fails
at cold start with an exec format error, which surfaces as an invoke timeout. The
platform is pinned in both the Dockerfile and `deploy.sh`.

**The Gateway secret is fetched, not injected.** The agent calls
`DescribeUserPoolClient` at cold start. Passing it as an environment variable
would mean CloudFormation resolving it through a custom resource, whose response
it stores in plaintext in the stack's event history. The Runtime's execution role
grants exactly that one read.

**The persona does not live here.** `system_prompt` arrives in the payload, built
by the same `prompts.ts` engine A uses. A second copy of Valentin's character in
this file would drift, and the comparison would stop being a comparison.

## Locally

There is no local path that exercises the Gateway — it needs the deployed
Cognito client and the deployed Gateway URL. To check the server boots:

```bash
pip install -r requirements.txt
AGENTCORE_GATEWAY_URL=... GATEWAY_CLIENT_ID=... COGNITO_USER_POOL_ID=... \
  BEDROCK_MODEL_ID=... python agent.py   # serves /invocations and /ping on 8080
```

Traces need CloudWatch Transaction Search enabled once per account; the command
is emitted as the `TransactionSearchCommand` output on the AgentCore stack.
