"""Valentin's agent, engine B.

Runs inside an AgentCore Runtime. The Node proxy calls `InvokeAgentRuntime` on
it (see `src/server/agent/agentcore-adapter.ts`), it reaches the profile tools
through the AgentCore Gateway, and AgentCore Memory does the preference
extraction that engine A does by hand.

WHAT THIS FILE IS NOT ALLOWED TO DECIDE

The persona and the profile. Both arrive in the payload as `system_prompt`,
built by `src/server/agent/prompts.ts` — the same function engine A uses. A
second copy of Valentin's character here would drift from engine A's, and the
comparison would then be measuring two different agents rather than two
platforms. The model id and the guardrail come from the environment, set by
`infra/lib/agentcore-stack.ts` from the same config values compute-stack.ts
gives engine A, for the same reason.
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any

import boto3
import requests
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands import Agent
from strands.models import BedrockModel
from strands.tools.mcp import MCPClient
from mcp.client.streamable_http import streamablehttp_client

logging.basicConfig(
    level=logging.INFO,
    format='{"level":"%(levelname)s","logger":"%(name)s","message":"%(message)s"}',
)
log = logging.getLogger("valentin.agentcore")

app = BedrockAgentCoreApp()

REGION = os.environ.get("AWS_REGION", "us-east-1")
MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "")
GUARDRAIL_ID = os.environ.get("BEDROCK_GUARDRAIL_ID", "")
GUARDRAIL_VERSION = os.environ.get("BEDROCK_GUARDRAIL_VERSION", "DRAFT")
GATEWAY_URL = os.environ.get("AGENTCORE_GATEWAY_URL", "")
GATEWAY_CLIENT_ID = os.environ.get("GATEWAY_CLIENT_ID", "")
GATEWAY_TOKEN_URL = os.environ.get("GATEWAY_TOKEN_URL", "")
GATEWAY_SCOPE = os.environ.get("GATEWAY_SCOPE", "valentin-tools/invoke")
USER_POOL_ID = os.environ.get("COGNITO_USER_POOL_ID", "")

# Refresh a minute before the hour is up. The client's `accessTokenValidity` is
# one hour, and a token that expires between "checked" and "used" fails the
# Gateway call with a 401 that reads as a tool outage.
TOKEN_SKEW_SECONDS = 60

_token: str | None = None
_token_expires_at: float = 0.0
_client_secret: str | None = None


def _gateway_client_secret() -> str:
    """The Gateway client's secret, read once at cold start.

    Deliberately fetched rather than injected: passing it as an environment
    variable would mean CloudFormation resolving it through a custom resource,
    whose response it stores in plaintext in the stack's event history. Read this
    way it exists only in this process's memory. See the long note in
    agentcore-stack.ts.
    """
    global _client_secret
    if _client_secret is None:
        idp = boto3.client("cognito-idp", region_name=REGION)
        described = idp.describe_user_pool_client(
            UserPoolId=USER_POOL_ID, ClientId=GATEWAY_CLIENT_ID
        )
        _client_secret = described["UserPoolClient"]["ClientSecret"]
    return _client_secret


def _gateway_token() -> str:
    """A client-credentials access token for the Gateway, cached until it expires."""
    global _token, _token_expires_at

    if _token and time.time() < _token_expires_at - TOKEN_SKEW_SECONDS:
        return _token

    response = requests.post(
        GATEWAY_TOKEN_URL,
        data={
            "grant_type": "client_credentials",
            "client_id": GATEWAY_CLIENT_ID,
            "scope": GATEWAY_SCOPE,
        },
        auth=(GATEWAY_CLIENT_ID, _gateway_client_secret()),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=10,
    )
    response.raise_for_status()
    body = response.json()

    _token = body["access_token"]
    _token_expires_at = time.time() + float(body.get("expires_in", 3600))
    return _token


def _build_model() -> BedrockModel:
    """The same model and the same guardrail engine A uses.

    Both are passed rather than defaulted: a guardrail applied on one engine and
    not the other would show up as a difference in what the agent is willing to
    say, and that difference has nothing to do with AgentCore.
    """
    kwargs: dict[str, Any] = {"model_id": MODEL_ID, "region_name": REGION}
    if GUARDRAIL_ID:
        kwargs["guardrail_id"] = GUARDRAIL_ID
        kwargs["guardrail_version"] = GUARDRAIL_VERSION
    return BedrockModel(**kwargs)


def _history_messages(history: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The proxy's history, in the shape Strands wants.

    Trimming already happened proxy-side against `MAX_CONTEXT_TOKENS`, so this
    only reshapes — re-trimming here would give engine B a smaller window than
    engine A and quietly make it look worse at remembering things.

    Anything that is not a recognised role is dropped rather than coerced: a turn
    filed under the wrong speaker is worse than a turn missing.
    """
    messages: list[dict[str, Any]] = []
    for entry in history:
        role = entry.get("role")
        content = entry.get("content")
        if role not in ("user", "assistant") or not isinstance(content, str):
            continue
        messages.append({"role": role, "content": [{"text": content}]})
    return messages


#: Arguments every Gateway tool needs and the model is never allowed to choose.
#:
#: Mirrors `identityArgs` in `infra/lib/gateway-identity-args.ts`, which is what
#: puts them in the schemas the Gateway advertises. They are required there
#: because the JWT on a Gateway call belongs to a *machine* client and carries no
#: end-user identity, so the caller has to name the user — see the trust-boundary
#: note at the top of `infra/lambda/profile-tools/index.mjs`.
IDENTITY_ARGS = ("user_id", "session_id")

#: Tools the proxy calls directly and the model must never see.
#:
#: A `confirm_*` tool carries out a proposal the user accepted. Leaving them in
#: the list the model reads would put a language model in the authority path for
#: spending someone's money, which is the exact thing propose-then-confirm exists
#: to prevent. The proxy calls them over the same Gateway (see
#: `src/server/agent/gateway-client.ts`), so nothing is lost by hiding them.
HIDDEN_TOOL_PREFIXES = ("confirm_",)


def _tool_suffix(name: str) -> str:
    """The bare tool name, with Gateway's `<target>___` prefix removed."""
    return name.rsplit("___", 1)[-1]


def _inject_identity(original: Any, identity: dict[str, str]) -> Any:
    """Wrap one tool entry point so the identity args are ours, not the model's.

    The model's value for `user_id` is *dropped* before ours is merged in, rather
    than merged over: `dict.update` would already win, but popping first states
    the rule explicitly — a model must not be able to name a different user, and
    that must be true no matter what it put in the arguments.

    Returns whatever the wrapped method returns without touching it, so this
    works for a coroutine, an async generator and a plain value alike. Strands
    has moved tool invocation between `invoke` and `stream` across versions, and
    this file cannot import the version it will run against.
    """

    def wrapper(tool_use: Any, *args: Any, **kwargs: Any) -> Any:
        if isinstance(tool_use, dict):
            merged = dict(tool_use.get("input") or {})
            for key in identity:
                merged.pop(key, None)
            merged.update(identity)
            tool_use = {**tool_use, "input": merged}
        return original(tool_use, *args, **kwargs)

    return wrapper


def _bind_identity(tools: list[Any], identity: dict[str, str]) -> list[Any]:
    """Bind this turn's user and session onto the Gateway's tools.

    Two halves, both necessary:

    1. **Strip the identity args from the schema the model sees.** A required
       argument the model cannot know is one it will hallucinate, and a
       hallucinated `user_id` reads a partition that does not exist — an empty
       profile rather than an error, which is the hardest kind of bug to see.
    2. **Inject them at call time.** Deterministically, in code, not as a line in
       the system prompt: a prompt instruction is a request, and the thing being
       requested here is the boundary between two users' data.

    Mutating the underlying MCP tool's `inputSchema` rather than overriding
    `tool_spec` is deliberate — `tool_spec` is derived from it in every Strands
    version, so this survives the derivation moving.

    Best-effort per tool, and loud about a failure: a tool this cannot bind is
    dropped rather than exposed unbound, because an unbound tool is one the model
    would be invited to fill in identity for.
    """
    bound: list[Any] = []
    for tool in tools:
        name = getattr(tool, "tool_name", "") or ""
        if _tool_suffix(name).startswith(HIDDEN_TOOL_PREFIXES):
            continue

        try:
            schema = getattr(getattr(tool, "mcp_tool", None), "inputSchema", None)
            if not isinstance(schema, dict):
                raise TypeError(f"no dict inputSchema on {name!r}")

            properties = schema.get("properties")
            if isinstance(properties, dict):
                for key in IDENTITY_ARGS:
                    properties.pop(key, None)
            required = schema.get("required")
            if isinstance(required, list):
                schema["required"] = [key for key in required if key not in IDENTITY_ARGS]

            wrapped = False
            for method_name in ("stream", "invoke"):
                original = getattr(tool, method_name, None)
                if callable(original):
                    setattr(tool, method_name, _inject_identity(original, identity))
                    wrapped = True
            if not wrapped:
                raise AttributeError(f"no stream/invoke to wrap on {name!r}")

            bound.append(tool)
        except Exception as err:  # noqa: BLE001 - one tool must not cost the turn
            log.warning(
                json.dumps(
                    {
                        "event": "tool.identity_bind_failed",
                        "tool": name,
                        "reason": f"{type(err).__name__}: {err}",
                    }
                )
            )

    return bound


def _tools_used(agent: Agent) -> list[str]:
    """Which Gateway tools the agent called, in order.

    Best-effort, and empty on any surprise: this feeds a label in the comparison
    UI, so an exception here would cost a whole answer to annotate one. Strands
    has moved this structure between versions, hence the defensive walk.
    """
    used: list[str] = []
    try:
        for message in getattr(agent, "messages", []):
            for block in message.get("content", []) or []:
                name = (block or {}).get("toolUse", {}).get("name")
                if name:
                    used.append(name)
    except Exception:  # noqa: BLE001 - never fail an answer over telemetry
        log.warning("could not read tool usage off the agent")
    return used


@app.entrypoint
def invoke(payload: dict[str, Any]) -> dict[str, Any]:
    """One turn.

    Request and response shapes are the contract `parseRuntimeReply` in
    `agentcore-adapter.ts` reads. Keep them in step: the proxy image and this
    image have separate tags, so a rolling deploy always has a window where one
    is newer. The adapter is tolerant about extra and renamed fields for exactly
    that reason, but `content` is the one field it cannot do without.
    """
    prompt = payload.get("prompt") or ""
    system_prompt = payload.get("system_prompt") or ""
    session_id = payload.get("session_id") or "unknown"
    history = payload.get("history") or []

    # `user_id`, not `actor_id`. Both name the same person, but `actor_id` has been
    # sanitised for AgentCore Memory (which rejects '#') and the Gateway's tools
    # key DynamoDB, where a demo visitor's id really is `<sub>#<visitorId>`. Using
    # the sanitised form here would read a partition engine A never writes. See
    # `AgentCoreTurn.userId` in `src/server/agent/agentcore-adapter.ts`.
    user_id = payload.get("user_id") or ""
    if not user_id:
        # Reachable during a rolling deploy, when a proxy older than this image
        # invokes it. Logged rather than raised: every Gateway tool call will then
        # fail its own `user_id` validation with a message the model can relay,
        # and a turn that answers without touching the profile is better than a
        # turn that does not answer.
        log.warning(
            json.dumps({"event": "turn.no_user_id", "sessionId": session_id})
        )

    started = time.time()
    model = _build_model()

    # The Gateway client is per-invocation, not module-level. Its session holds an
    # access token that expires, and a long-lived one would start failing tool
    # calls an hour after the first cold start with nothing in the logs to say why.
    gateway = MCPClient(
        lambda: streamablehttp_client(
            GATEWAY_URL, headers={"Authorization": f"Bearer {_gateway_token()}"}
        )
    )

    try:
        with gateway:
            tools = _bind_identity(
                gateway.list_tools_sync(),
                {"user_id": user_id, "session_id": session_id},
            )
            agent = Agent(
                model=model,
                system_prompt=system_prompt,
                messages=_history_messages(history),
                tools=tools,
            )
            result = agent(prompt)

            content = str(result)
            used = _tools_used(agent)

            log.info(
                json.dumps(
                    {
                        "event": "agent.turn",
                        "sessionId": session_id,
                        "durationMs": int((time.time() - started) * 1000),
                        "toolsUsed": used,
                        "historyTurns": len(history),
                    }
                )
            )
            return {"content": content, "tools_used": used}

    except Exception as err:  # noqa: BLE001
        # Returned as an error field rather than raised, so the proxy sees a 200
        # with a diagnosable body instead of a bare 5xx. The proxy still shows the
        # user its own apology — it treats a missing `content` as a failed turn —
        # but the cause reaches the log group instead of being swallowed by the
        # Runtime's generic error page.
        log.exception("turn failed")
        return {
            "content": "",
            "tools_used": [],
            "error": f"{type(err).__name__}: {err}",
        }


if __name__ == "__main__":
    # `run()` serves `/invocations` and `/ping` on 8080, which is the contract
    # `protocolConfiguration: 'HTTP'` in agentcore-stack.ts selects.
    app.run()
