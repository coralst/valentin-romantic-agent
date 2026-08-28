# ARM64, and not negotiable: AgentCore Runtime runs arm64 only, and an amd64
# image is accepted at deploy time and then fails at cold start with an exec
# format error — which surfaces as an invoke timeout rather than as a build
# problem. `scripts/deploy.sh` passes `--platform linux/arm64` for this reason,
# even on an Apple Silicon machine where it looks redundant.
FROM --platform=linux/arm64 public.ecr.aws/docker/library/python:3.12-slim

WORKDIR /app

# Layer separately from the source so an edit to agent.py does not reinstall
# Strands and its transitive tree on every deploy.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY agent.py .

# Non-root. The Runtime does not require it, but nothing here needs root and the
# image is one `pip install` away from executing model-chosen tool calls.
RUN useradd --create-home --uid 10001 valentin
USER valentin

# The port `protocolConfiguration: 'HTTP'` expects `/invocations` and `/ping` on.
EXPOSE 8080

# `opentelemetry-instrument` rather than a bare `python`: it is what wires the
# span exporter to the Runtime's collector, and without it the Observability half
# of the comparison is empty. Traces still need CloudWatch Transaction Search
# enabled once per account — see the TransactionSearchCommand output on the
# AgentCore stack.
CMD ["opentelemetry-instrument", "python", "agent.py"]
