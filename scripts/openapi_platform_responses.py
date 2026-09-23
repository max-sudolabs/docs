"""Add source-verified platform response contracts missing from upstream OpenAPI.

These overrides supplement (never replace wholesale) upstream responses. Keep them
until the corresponding declarations are fixed upstream. Source paths below are
relative to https://github.com/e2b-dev/infra/blob/
0c21aa2277b59a1d040761ed3fbbb29a78775470/ .
Live response and webhook boundary checks were performed on 2026-09-23.
Examples document particular conditions, not an exhaustive list of messages.
"""

from __future__ import annotations

from copy import deepcopy
from http import HTTPStatus
from typing import Any

SOURCE_ROOT = "https://github.com/e2b-dev/infra/blob/0c21aa2277b59a1d040761ed3fbbb29a78775470/"

# Handler/helper statuses individually traced for each operation. Do not expand
# the webhook mapper's possible 400/429 onto unrelated operations: its typed
# WEBHOOK_LIMIT_REACHED condition is not a contract for every webhook RPC.
# Success codes are left to the source contract and the success-shape overrides.
HANDLER_STATUSES = {
    # packages/api/internal/handlers/sandboxes_list.go:207-240
    ('get', '/sandboxes'): ('400', '500'),
    # packages/api/internal/handlers/sandbox_create.go:66-412
    ('post', '/sandboxes'): ('400', '403', '404', '429', '500', '503', '504'),
    # packages/api/internal/handlers/sandbox_create.go:82-412
    ('post', '/v2/sandboxes'): ('400', '403', '404', '429', '500', '503', '504'),
    # packages/api/internal/handlers/sandboxes_list.go:242-402
    ('get', '/v2/sandboxes'): ('400', '500'),
    # packages/api/internal/handlers/sandboxes_list_metrics.go:23-94
    ('get', '/sandboxes/metrics'): ('400', '500'),
    # packages/api/internal/handlers/sandbox_logs.go:22-118
    ('get', '/sandboxes/{sandboxID}/logs'): ('400', '500'),
    # packages/api/internal/handlers/sandbox_logs.go:51-118
    ('get', '/v2/sandboxes/{sandboxID}/logs'): ('400', '500'),
    # packages/api/internal/handlers/sandbox_get.go:97-270
    ('get', '/sandboxes/{sandboxID}'): ('400', '404', '500'),
    # packages/api/internal/handlers/sandbox_kill.go:39-104
    ('delete', '/sandboxes/{sandboxID}'): ('400', '404', '500'),
    # packages/api/internal/handlers/sandbox_metrics.go:16-47
    ('get', '/sandboxes/{sandboxID}/metrics'): ('400', '500'),
    # packages/api/internal/handlers/sandbox_pause.go:45-174
    ('post', '/sandboxes/{sandboxID}/pause'): ('400', '404', '409', '500', '503'),
    # packages/api/internal/handlers/sandbox_resume.go:47-212
    ('post', '/sandboxes/{sandboxID}/resume'): ('400', '404', '409', '429', '500', '503', '504'),
    # packages/api/internal/handlers/sandbox_fork.go:37-185
    ('post', '/sandboxes/{sandboxID}/fork'): ('400', '404', '409', '500', '503'),
    # packages/api/internal/handlers/sandbox_connect.go:42-232
    ('post', '/sandboxes/{sandboxID}/connect'): ('400', '404', '409', '429', '500', '503', '504'),
    # packages/api/internal/handlers/sandbox_connect.go:67-232
    ('post', '/v2/sandboxes/{sandboxID}/connect'): ('400', '404', '409', '429', '500', '503', '504'),
    # packages/api/internal/handlers/sandbox_timeout.go:17-60
    ('post', '/sandboxes/{sandboxID}/timeout'): ('400', '404', '409', '500'),
    # packages/api/internal/handlers/sandbox_network_update.go:21-136
    ('put', '/sandboxes/{sandboxID}/network'): ('400', '403', '404', '409', '500'),
    # packages/api/internal/handlers/sandbox_refresh.go:18-65
    ('post', '/sandboxes/{sandboxID}/refreshes'): ('400', '404', '409', '500'),
    # packages/api/internal/handlers/snapshot_template_create.go:35-175
    ('post', '/sandboxes/{sandboxID}/snapshots'): ('400', '403', '404', '409', '500', '503'),
    # packages/api/internal/handlers/snapshot_template_list.go:25-140
    ('get', '/snapshots'): ('400', '500'),
    # packages/api/internal/handlers/template_request_build_v3.go:24
    # packages/api/internal/template/register_build.go:249
    ('post', '/v3/templates'): ('400', '401', '403', '404', '409', '429', '500'),
    # packages/api/internal/handlers/templates_list_v2.go:21
    ('get', '/v2/templates'): ('400', '401', '403', '500'),
    # packages/api/internal/handlers/template_layer_files_upload.go:19
    ('get', '/templates/{templateID}/files/{hash}'): ('400', '401', '403', '404', '500', '503'),
    # packages/api/internal/handlers/templates_list.go:13
    ('get', '/templates'): ('400', '401', '403', '500'),
    # packages/api/internal/handlers/template_get.go:26
    ('get', '/templates/{templateID}'): ('400', '401', '403', '404', '500'),
    # packages/api/internal/handlers/template_delete.go:58
    ('delete', '/templates/{templateID}'): ('400', '401', '403', '404', '500'),
    # packages/api/internal/handlers/template_update.go:25
    ('patch', '/templates/{templateID}'): ('400', '401', '403', '404', '409', '500'),
    # packages/api/internal/handlers/template_start_build_v2.go:92
    ('post', '/v2/templates/{templateID}/builds/{buildID}'): ('400', '401', '403', '404', '500', '503'),
    # packages/api/internal/handlers/template_update.go:40
    ('patch', '/v2/templates/{templateID}'): ('400', '401', '403', '404', '500'),
    # packages/api/internal/handlers/template_build_status.go:25
    ('get', '/templates/{templateID}/builds/{buildID}/status'): ('400', '401', '403', '500'),
    # packages/api/internal/handlers/template_build_logs.go:18
    ('get', '/templates/{templateID}/builds/{buildID}/logs'): ('400', '401', '403', '500'),
    # packages/api/internal/handlers/template_alias.go:19
    ('get', '/templates/aliases/{alias}'): ('400', '401', '403', '404', '500'),
    # packages/api/internal/handlers/template_tags.go:26
    ('post', '/templates/tags'): ('400', '401', '403', '404', '500'),
    # packages/api/internal/handlers/template_tags.go:184
    ('delete', '/templates/tags'): ('400', '401', '403', '404', '500'),
    # packages/api/internal/handlers/template_tags.go:300
    ('get', '/templates/{templateID}/tags'): ('400', '401', '403', '404', '500'),
    # packages/api/internal/handlers/volumes_list.go:12
    ('get', '/volumes'): ('401', '403', '500'),
    # packages/api/internal/handlers/volume_create.go:26
    ('post', '/volumes'): ('400', '401', '403', '500', '501', '503'),
    # packages/api/internal/handlers/volume_get.go:12; volume_util.go:41
    ('get', '/volumes/{volumeID}'): ('400', '401', '403', '404', '500', '503'),
    # packages/api/internal/handlers/volume_delete.go:20; volume_util.go:41
    ('delete', '/volumes/{volumeID}'): ('400', '401', '403', '404', '500'),
    # packages/api/internal/handlers/team_metrics.go:19
    ('get', '/teams/{teamID}/metrics'): ('400', '403', '500'),
    # packages/api/internal/handlers/team_metrics_max.go:18
    ('get', '/teams/{teamID}/metrics/max'): ('400', '403', '500'),
    # packages/api/internal/handlers/secrets.go:118; secrets.go:294,347
    ('get', '/secrets'): ('400', '401', '403', '404', '409', '502', '504'),
    # packages/api/internal/handlers/secrets.go:70; secrets.go:294,347
    ('post', '/secrets'): ('400', '401', '403', '404', '409', '502', '504'),
    # packages/api/internal/handlers/secrets.go:169; secrets.go:294,347
    ('get', '/secrets/{secretID}'): ('400', '401', '403', '404', '409', '502', '504'),
    # packages/api/internal/handlers/secrets.go:206; secrets.go:294,347
    ('post', '/secrets/{secretID}'): ('400', '401', '403', '404', '409', '502', '504'),
    # packages/api/internal/handlers/secrets.go:261; secrets.go:294,347
    ('delete', '/secrets/{secretID}'): ('400', '401', '403', '404', '409', '502', '504'),
    # packages/api/internal/handlers/sandbox_events.go:56; webhooks_backend.go:93
    ('get', '/events/sandboxes/{sandboxID}'): ('400', '404', '500', '503', '504'),
    # packages/api/internal/handlers/sandbox_events.go:32; webhooks_backend.go:93
    ('get', '/events/sandboxes'): ('400', '404', '500', '503', '504'),
    # packages/api/internal/handlers/webhooks.go:35; webhooks_backend.go:93
    ('post', '/events/webhooks'): ('400', '404', '500', '503', '504'),
    # packages/api/internal/handlers/webhooks.go:77; webhooks_backend.go:93
    ('get', '/events/webhooks'): ('404', '500', '503', '504'),
    # packages/api/internal/handlers/webhooks.go:110; webhooks_backend.go:93
    ('get', '/events/webhooks/{webhookID}'): ('404', '500', '503', '504'),
    # packages/api/internal/handlers/webhooks.go:163; webhooks_backend.go:93
    ('patch', '/events/webhooks/{webhookID}'): ('400', '404', '500', '503', '504'),
    # packages/api/internal/handlers/webhooks.go:140; webhooks_backend.go:93
    ('delete', '/events/webhooks/{webhookID}'): ('404', '500', '503', '504'),
    # packages/api/internal/handlers/webhook_deliveries.go:36; webhooks_backend.go:93
    ('get', '/events/webhooks/{webhookID}/deliveries'): ('400', '404', '500', '503', '504'),
    # packages/api/internal/handlers/webhook_deliveries.go:136; webhooks_backend.go:93
    ('get', '/events/webhooks/{webhookID}/stats'): ('400', '404', '500', '503', '504'),
}

# packages/api/internal/middleware/blocked_team.go:15-52 and
# packages/auth/pkg/auth/internal/team/middleware.go:60-76, state.go:26-36.
BLOCKED_TEAM_ROUTES = {
    ('post', '/sandboxes'),
    ('post', '/v2/sandboxes'),
    ('post', '/sandboxes/{sandboxID}/pause'),
    ('post', '/sandboxes/{sandboxID}/resume'),
    ('post', '/sandboxes/{sandboxID}/fork'),
    ('post', '/sandboxes/{sandboxID}/connect'),
    ('post', '/v2/sandboxes/{sandboxID}/connect'),
    ('post', '/sandboxes/{sandboxID}/timeout'),
    ('put', '/sandboxes/{sandboxID}/network'),
    ('post', '/sandboxes/{sandboxID}/refreshes'),
    ('post', '/sandboxes/{sandboxID}/snapshots'),
    ('post', '/v3/templates'),
    ('get', '/templates/{templateID}/files/{hash}'),
    ('patch', '/templates/{templateID}'),
    ('post', '/v2/templates/{templateID}/builds/{buildID}'),
    ('patch', '/v2/templates/{templateID}'),
    ('post', '/templates/tags'),
    ('post', '/volumes'),
    ('post', '/secrets'),
    ('post', '/secrets/{secretID}'),
    ('delete', '/secrets/{secretID}'),
    ('post', '/events/webhooks'),
    ('patch', '/events/webhooks/{webhookID}'),
    ('delete', '/events/webhooks/{webhookID}'),
}


def _resolved_copy(spec: dict, obj: dict) -> dict:
    """Resolve local references before editing; never mutate a shared component."""
    obj = deepcopy(obj)
    seen = set()
    while "$ref" in obj:
        ref = obj["$ref"]
        if not ref.startswith("#/") or ref in seen:
            raise ValueError(f"Cannot customize response reference: {ref}")
        seen.add(ref)
        target = spec
        for part in ref[2:].split("/"):
            target = target[part.replace("~1", "/").replace("~0", "~")]
        siblings = {key: value for key, value in obj.items() if key != "$ref"}
        obj = deepcopy(target)
        obj.update(siblings)
    return obj


def _response(spec: dict, op: dict, status: str) -> dict:
    responses = op.setdefault("responses", {})
    source = responses.get(status)
    if source is None:
        source = spec.get("components", {}).get("responses", {}).get(status)
    if source is None:
        source = {
            "description": HTTPStatus(int(status)).phrase,
            "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}},
        }
    response = _resolved_copy(spec, source)
    responses[status] = response
    return response


def _example(spec: dict, op: dict, status: str, name: str, message: str, condition: str, fields: dict | None = None) -> None:
    response = _response(spec, op, status)
    media = response.setdefault("content", {}).setdefault("application/json", {
        "schema": {"$ref": "#/components/schemas/Error"},
    })
    # OAS makes example and examples mutually exclusive. Preserve a source's
    # single example as a named example before adding operation-specific ones.
    examples = media.setdefault("examples", {})
    if "example" in media:
        examples.setdefault("upstream", {"value": media.pop("example")})
    examples.setdefault(name, {"summary": condition, "value": {"code": int(status), "message": message, **(fields or {})}})


def _operation(spec: dict, method: str, path: str) -> dict | None:
    return spec.get("paths", {}).get(path, {}).get(method)


def _add(spec: dict, method: str, path: str, status: str, name: str, message: str, condition: str) -> None:
    op = _operation(spec, method, path)
    if op is not None:
        _example(spec, op, status, name, message, condition)


def _shared_errors(spec: dict, method: str, path: str, op: dict) -> None:
    is_secret = path == "/secrets" or path.startswith("/secrets/")
    security = op.get("security", spec.get("security", []))
    # Team bans are checked while authenticating API keys, before the handler.
    # packages/auth/pkg/auth/internal/team/state.go:13-17
    # packages/api/internal/utils/error.go:24-59,96-110
    if any("ApiKeyAuth" in requirement for requirement in security):
        _example(spec, op, "403", "teamBanned",
                 "Secrets are not available for this team" if is_secret else "team is banned",
                 "The team is banned at authentication")
    if "401" in op.get("responses", {}) and not is_secret:
        # packages/auth/pkg/auth/internal/middleware/middleware.go:39-42
        _example(spec, op, "401", "missingAuthentication", "authorization header is missing",
                 "No supported authentication header was supplied")
    if (method, path) in BLOCKED_TEAM_ROUTES:
        _example(spec, op, "403", "teamBlocked", "team is blocked",
                 "The authenticated team is blocked. The message may append a reason")
    if "429" in op.get("responses", {}):
        # packages/api/internal/middleware/ratelimit/ratelimit.go:244-257.
        # Only augment an existing declaration, not a claim every route has a
        # configured limiter. Other 429 causes need not carry these headers.
        _example(spec, op, "429", "rateLimitExceeded", "Rate limit exceeded",
                 "A configured API rate limit was exceeded")
        headers = _response(spec, op, "429").setdefault("headers", {})
        for name, description in {
            "Retry-After": "Seconds until retrying a rate-limited request.",
            "RateLimit-Limit": "Configured rate-limit burst size.",
            "RateLimit-Remaining": "Requests remaining in the rate-limit window.",
            "RateLimit-Reset": "Seconds until the rate-limit window resets.",
        }.items():
            headers.setdefault(name, {"description": description, "schema": {"type": "integer"}})


def _secret_errors(spec: dict, op: dict) -> None:
    # packages/api/internal/middleware/secrets.go:23-35,44-53
    # packages/api/internal/handlers/secrets.go:294-405
    # packages/api/internal/utils/error.go:24-59
    messages = {
        "400": ("invalidSecretsRequest", "Invalid secrets request", "Request validation or the secrets backend rejects the input"),
        "401": ("secretsUnauthorized", "You are not authenticated", "Authentication is missing or invalid"),
        "403": ("secretsUnavailable", "Secrets are not available for this team", "The secrets feature or backend is unavailable for the team"),
        "404": ("secretNotFound", "Secret not found", "The secrets backend cannot find the requested secret"),
        "409": ("secretConflict", "Secret cannot be modified in its current state", "Conflict, failed precondition, aborted modification, or secret limit reached"),
        "502": ("secretsBackendError", "Secrets backend error", "The secrets backend failed or returned an unusable response"),
        "504": ("secretsBackendTimeout", "Secrets backend timed out", "The secrets backend deadline was exceeded"),
    }
    for status, (name, message, condition) in messages.items():
        _example(spec, op, status, name, message, condition)
    _example(spec, op, "404", "preHandlerNotFound", "Not found",
             "A request is rejected as not found before reaching the secrets handler")
    for status in list(op.get("responses", {})):
        _response(spec, op, status).setdefault("headers", {}).setdefault("Cache-Control", {
            "description": "Secret-management responses must not be cached.",
            "schema": {"type": "string", "enum": ["no-store"]},
        })


def _event_errors(spec: dict, method: str, path: str, op: dict) -> None:
    # packages/api/internal/handlers/webhooks_backend.go:93-126
    # packages/api/internal/handlers/{webhooks,sandbox_events,webhook_deliveries}.go
    sandbox_events = path.startswith("/events/sandboxes")
    if sandbox_events:
        missing, unavailable, fallback = "Sandbox events not found", "Sandbox events are not available", "Error when querying sandbox events"
    else:
        missing, unavailable = "Webhook not found", "Webhooks are not available"
        if path.endswith("/deliveries"):
            fallback = "Error when querying webhook deliveries"
        elif path.endswith("/stats"):
            fallback = "Error when querying webhook delivery stats"
        else:
            verb = {"get": "list" if path == "/events/webhooks" else "get", "post": "create", "patch": "update", "delete": "delete"}[method]
            fallback = f"Failed to {verb} webhook" + ("s" if verb == "list" else "")
    _example(spec, op, "404", "resourceNotFound", missing, "The backend cannot find the requested resource")
    _example(spec, op, "503", "backendUnavailable", unavailable, "The backend is not configured")
    _example(spec, op, "504", "backendDeadlineExceeded", fallback, "The backend deadline was exceeded")
    _example(spec, op, "500", "backendError", fallback, "The backend failed")


def _specific_errors(spec: dict) -> None:
    # Source locations for each family are in HANDLER_STATUSES above.
    for method, path in HANDLER_STATUSES:
        if "{sandboxID}" in path and not path.startswith("/events/"):
            op = _operation(spec, method, path)
            if op is not None and "400" in op.get("responses", {}):
                _example(spec, op, "400", "invalidSandboxId", "Invalid sandbox ID", "The sandbox ID is malformed")
    for path in ("/sandboxes", "/v2/sandboxes"):
        _add(spec, "post", path, "404", "templateNotFound", "template 'my-template' not found", "The template reference cannot be resolved")
        _add(spec, "post", path, "403", "egressProxyDisabled", "Egress proxy (network.egressProxy) is not enabled for this team.", "Egress proxy configuration was supplied without feature access")
    for path in ("/v2/sandboxes", "/snapshots", "/v2/templates", "/templates/{templateID}"):
        _add(spec, "get", path, "400", "invalidNextToken", "Invalid next token", "The pagination token cannot be decoded")
    for path in ("/sandboxes/{sandboxID}/timeout", "/sandboxes/{sandboxID}/refreshes"):
        _add(spec, "post", path, "409", "sandboxChangingState", 'Sandbox "sandboxid" is being paused', "The sandbox is changing state")
        _add(spec, "post", path, "400", "maxInstanceLengthExceeded", "Max instance length exceeded", "The requested timeout exceeds the sandbox lifetime limit")
    _add(spec, "post", "/sandboxes/{sandboxID}/snapshots", "409", "snapshotStateConflict", "Sandbox 'sandboxid' cannot be snapshotted while in 'pausing' state", "The current sandbox state does not allow a snapshot")
    _add(spec, "post", "/sandboxes/{sandboxID}/snapshots", "503", "snapshotNodeBusy", "Sandbox 'sandboxid' cannot be snapshotted right now because its node is busy, please retry", "The node cannot accept snapshot work")
    _add(spec, "post", "/v3/templates", "404", "templateDeleted", "Template 'my-template' has been deleted and cannot be rebuilt", "The template was deleted while registering the build")
    _add(spec, "get", "/templates", "400", "teamMismatch", "Team ID param mismatch with the API key", "The team parameter does not match the API key")
    _add(spec, "get", "/templates/{templateID}", "404", "templateNotFound", "Template my-template not found", "The template was not found")
    _add(spec, "patch", "/templates/{templateID}", "409", "publicAliasTaken", "Public template name 'my-template' is already taken. Your template is available at 'my-team/my-template'. Please update your CLI to remove this error message.", "The legacy endpoint cannot create the backward-compatible public alias")
    for state in ("running", "paused"):
        _add(spec, "delete", "/templates/{templateID}", "400", state + "Sandboxes", f"cannot delete template 'my-template' because there are {state} sandboxes using it", f"The template is still used by {state} sandboxes")
    for path in ("/templates/aliases/{alias}", "/templates/{templateID}/tags"):
        _add(spec, "get", path, "404", "templateNotFound", "template 'my-template' not found", "The template reference cannot be resolved")
    for suffix in ("status", "logs"):
        path = "/templates/{templateID}/builds/{buildID}/" + suffix
        _add(spec, "get", path, "400", "buildNotFound", "Build '00000000-0000-0000-0000-000000000000' not found", "The build ID is valid but the build was not found")
        _add(spec, "get", path, "400", "invalidBuildId", "Invalid build id", "The build ID is malformed")
        _add(spec, "get", path, "403", "templateAccessDenied", "You don't have access to this sandbox template (my-template)", "The authenticated team cannot access the template")
    for method, path in (("get", "/templates/{templateID}/files/{hash}"), ("post", "/v2/templates/{templateID}/builds/{buildID}")):
        _add(spec, method, path, "503", "buildClientUnavailable", "Error when getting available build client", "No available build client could be selected")
    _add(spec, "get", "/templates/{templateID}/files/{hash}", "400", "invalidFilesHash", "Invalid files hash", "The upload hash is malformed")
    _add(spec, "post", "/v2/templates/{templateID}/builds/{buildID}", "400", "buildNotWaiting", "build is not in waiting state", "The build cannot be started in its current state")
    for method in ("post", "delete"):
        _add(spec, method, "/templates/tags", "400", "emptyTags", "At least one tag is required", "No tags were supplied")
    _add(spec, "delete", "/templates/tags", "400", "defaultTag", "Cannot delete the 'default' tag", "The reserved default tag cannot be deleted")
    for method in ("get", "delete"):
        _add(spec, method, "/volumes/{volumeID}", "400", "invalidVolumeId", "Invalid volume ID", "The volume ID is malformed")
        _add(spec, method, "/volumes/{volumeID}", "404", "volumeNotFound", "Volume not found", "The volume was not found for this team")
    for method, path in (("post", "/volumes"), ("get", "/volumes/{volumeID}")):
        _add(spec, method, path, "503", "clusterNotFound", "Cluster not found", "The team's cluster could not be resolved")
    _add(spec, "post", "/volumes", "403", "volumesDisabled", "use of volumes is not enabled", "Volumes are not enabled for this team")
    _add(spec, "post", "/volumes", "501", "volumeSigningUnavailable", "volumes content token signing is not supported by this deployment", "The deployment has no volume content-token signing configuration")
    # These exact validation messages and their failing inputs were confirmed
    # live on 2026-09-23 (valid IDs and owned resources, without fault injection).
    _add(spec, "get", "/events/webhooks/{webhookID}/stats", "400", "rangeTooLong", "Stats range must be 7 days or less", "The requested statistics range exceeds seven days")
    _add(spec, "get", "/events/webhooks/{webhookID}/deliveries", "400", "rangeTooLong", "deliveries range must be 7 days or less", "The requested deliveries range exceeds seven days")
    for method, path in (("post", "/events/webhooks"), ("patch", "/events/webhooks/{webhookID}")):
        _add(spec, method, path, "400", "invalidEventType", "Invalid event type: invalid.event", "An unrecognized webhook event type was supplied")
        _add(spec, method, path, "400", "signingSecretTooShort", "Webhook secret must be at least 32 characters long", "The webhook signing secret is shorter than 32 characters")


def _remaining_handler_examples(spec: dict) -> None:
    """Concrete messages for source branches beyond the original audit probes."""
    # Source paths here are relative to SOURCE_ROOT + packages/api/internal/.
    # sandboxes_list.go:220-235,291-305,341-345,380-386; utils/sandboxes_list.go:30-43,201-205.
    # Both metadata examples were also reproduced live in three rounds.
    _add(spec, "get", "/sandboxes", "400", "invalidMetadata",
         'Error parsing metadata: error parsing metadata: error when unescaping query: invalid URL escape "%zz"',
         "The metadata filter contains the invalid URL escape %zz")
    _add(spec, "get", "/v2/sandboxes", "400", "invalidMetadata", "Error parsing metadata", "The metadata filter cannot be parsed")
    for path in ("/sandboxes", "/v2/sandboxes"):
        _add(spec, "get", path, "500", "sandboxListFailed", "Error when getting sandboxes", "The API cannot retrieve running sandboxes")
    _add(spec, "get", "/v2/sandboxes", "500", "pausedSandboxListFailed", "Error getting paused sandboxes", "The API cannot retrieve paused sandboxes")

    # One fixed 500 branch per operation; source handler and line number are
    # adjacent to each entry. The full error set remains open, including empty
    # responses from panic recovery. These examples do not promise JSON on every 500.
    server_errors = [
        ("get", "/sandboxes/metrics", "cluster not found for sandbox metrics", "The team's metrics cluster cannot be resolved", "sandboxes_list_metrics.go:56-62"),
        ("get", "/sandboxes/{sandboxID}/logs", "Failed to get cluster", "The sandbox's logs cluster cannot be resolved", "sandbox_logs.go:105-113"),
        ("get", "/v2/sandboxes/{sandboxID}/logs", "Failed to get cluster", "The sandbox's logs cluster cannot be resolved", "sandbox_logs.go:105-113"),
        ("get", "/sandboxes/{sandboxID}", "Error getting sandbox", "The sandbox snapshot lookup fails", "sandbox_get.go:191-192"),
        ("delete", "/sandboxes/{sandboxID}", "Error killing sandbox: sandbox operation failed", "The sandbox removal operation fails", "sandbox_kill.go:73-74; orchestrator/errors.go:8"),
        ("get", "/sandboxes/{sandboxID}/metrics", "cluster not found for sandbox metrics", "The team's metrics cluster cannot be resolved", "sandbox_metrics.go:34-38"),
        ("post", "/sandboxes/{sandboxID}/pause", "Error pausing sandbox", "The pause operation fails", "sandbox_pause.go:124-128"),
        ("post", "/sandboxes/{sandboxID}/resume", "Error when getting snapshot", "The saved snapshot lookup fails", "sandbox_resume.go:166-167"),
        ("post", "/sandboxes/{sandboxID}/fork", "Error forking sandbox", "The fork checkpoint fails", "sandbox_fork.go:138-139"),
        ("post", "/sandboxes/{sandboxID}/connect", "Error when getting snapshot", "The saved snapshot lookup fails", "sandbox_connect.go:179-180"),
        ("post", "/v2/sandboxes/{sandboxID}/connect", "Error when getting snapshot", "The saved snapshot lookup fails", "sandbox_connect.go:179-180"),
        ("post", "/sandboxes/{sandboxID}/timeout", "Error when setting sandbox timeout", "Updating the sandbox timeout fails", "orchestrator/keep_alive.go:47-66"),
        ("post", "/sandboxes/{sandboxID}/refreshes", "Error when setting sandbox timeout", "Updating the sandbox lifetime fails", "orchestrator/keep_alive.go:47-66"),
        ("put", "/sandboxes/{sandboxID}/network", "Failed to get sandbox", "Looking up the sandbox for network-rule validation fails", "sandbox_network_update.go:85-90"),
        ("post", "/sandboxes/{sandboxID}/snapshots", "Error creating snapshot template", "Creating the snapshot template fails", "snapshot_template_create.go:144-145"),
        ("get", "/snapshots", "Error listing snapshot templates", "The snapshot query fails", "snapshot_template_list.go:118-119"),
        ("post", "/v3/templates", "Error when checking the team's cluster", "The team's template-build cluster cannot be read", "template_request_build_v3.go:95-96"),
        ("get", "/templates", "Error when getting templates", "The template query fails", "templates_list.go:37-39"),
        ("get", "/v2/templates", "Error when getting templates", "The template query fails", "templates_list_v2.go:67-68"),
        ("get", "/templates/{templateID}", "Error when getting template", "The template lookup fails", "template_get.go:49"),
        ("delete", "/templates/{templateID}", "Error when deleting template", "The template deletion fails", "template_delete.go:124"),
        ("patch", "/templates/{templateID}", "Error updating template", "The template update fails", "template_update.go:125"),
        ("patch", "/v2/templates/{templateID}", "Error updating template", "The template update fails", "template_update.go:125"),
        ("get", "/templates/{templateID}/files/{hash}", "Error when requesting layer files upload", "The build client cannot create the upload descriptor", "template_layer_files_upload.go:66"),
        ("post", "/v2/templates/{templateID}/builds/{buildID}", "Error during template build request", "Creating the build record fails", "template_start_build_v2.go:183"),
        ("get", "/templates/{templateID}/builds/{buildID}/status", "Error when getting template", "Looking up the build fails", "template_build_status.go:45"),
        ("get", "/templates/{templateID}/builds/{buildID}/logs", "Error when getting template", "Looking up the build fails", "template_build_logs.go:38"),
        ("get", "/templates/aliases/{alias}", "Error when checking template tag existence", "Looking up an explicit template tag fails", "template_alias.go:80"),
        ("post", "/templates/tags", "Error creating tag assignment", "Writing a template tag assignment fails", "template_tags.go:139"),
        ("delete", "/templates/tags", "Error deleting tag assignments", "Deleting template tag assignments fails", "template_tags.go:276"),
        ("get", "/templates/{templateID}/tags", "Error when listing template tags", "Listing template tags fails", "template_tags.go:341"),
        ("get", "/volumes", "Error when getting volumes", "The volume query fails", "volumes_list.go:29"),
        ("post", "/volumes", "No persistent volume type is configured", "The deployment has no default volume type", "volume_create.go:84"),
        ("get", "/volumes/{volumeID}", "failed to sign token", "The API cannot sign a volume content token", "volume_get.go:28"),
        ("delete", "/volumes/{volumeID}", "Error recording volume deletion", "Recording the volume deletion fails", "volume_delete.go:35"),
        ("get", "/teams/{teamID}/metrics/max", "Error querying max team metrics", "The maximum-metrics query fails", "team_metrics_max.go:77"),
    ]
    for method, path, message, condition, source in server_errors:
        _add(spec, method, path, "500", "operationFailed", message, condition)

    # Sandbox lookup messages: utils/messages.go:9-10, called by each of these
    # handlers. Logs and metrics deliberately excluded: they query historical
    # data and do not call this helper when a sandbox is absent.
    lookups = [
        ("get", "/sandboxes/{sandboxID}"), ("delete", "/sandboxes/{sandboxID}"),
        *(("post", "/sandboxes/{sandboxID}/" + name) for name in ("pause", "resume", "fork", "connect", "timeout", "refreshes", "snapshots")),
        ("post", "/v2/sandboxes/{sandboxID}/connect"), ("put", "/sandboxes/{sandboxID}/network"),
    ]
    for method, path in lookups:
        _add(spec, method, path, "404", "sandboxNotFound", 'Sandbox "sandboxid" doesn\'t exist or you don\'t have access to it', "No accessible sandbox or saved snapshot was found")

    # sandbox_pause.go:109-121; sandbox_resume.go:132; sandbox_fork.go:130-134;
    # sandbox_connect.go:142-143; orchestrator/update_network.go:73.
    for name, verb in (("pause", "paused"), ("fork", "forked")):
        path = "/sandboxes/{sandboxID}/" + name
        _add(spec, "post", path, "409", "stateConflict", f"Sandbox 'sandboxid' cannot be {verb} while in 'pausing' state", "The current sandbox state does not permit the operation")
        _add(spec, "post", path, "503", "nodeBusy", f"Sandbox 'sandboxid' cannot be {verb} right now because its node is busy, please retry", "The node cannot accept snapshot work")
    _add(spec, "post", "/sandboxes/{sandboxID}/resume", "409", "alreadyRunning", "Sandbox sandboxid is already running", "The sandbox is already running")
    for method, path, state in (("post", "/sandboxes/{sandboxID}/connect", "killed"), ("post", "/v2/sandboxes/{sandboxID}/connect", "killed"), ("put", "/sandboxes/{sandboxID}/network", "paused")):
        _add(spec, method, path, "409", "stateConflict", f'Sandbox "sandboxid" is being {state}', "The sandbox is changing state")

    # All five operations reach CreateSandbox and placementAPIError. Fork's
    # per-child placement failures are carried inside its 201 payload instead.
    # orchestrator/create_instance.go:407-413; orchestrator/placement_errors.go:65-80.
    for path in ("/sandboxes", "/v2/sandboxes", "/sandboxes/{sandboxID}/resume", "/sandboxes/{sandboxID}/connect", "/v2/sandboxes/{sandboxID}/connect"):
        op = _operation(spec, "post", path)
        if op is None:
            continue
        for status, name, message, semantic, condition in (
            ("503", "capacityUnavailable", "Failed to place sandbox: not enough capacity for the requested resources right now, please retry shortly", "sandbox_capacity_unavailable", "No node has capacity for the requested sandbox"),
            ("504", "placementTimeout", "Failed to place sandbox: placement timed out, please retry", "sandbox_placement_timeout", "Placement times out before its first attempt"),
        ):
            _example(spec, op, status, name, message, condition, {"error_code": semantic})
    for path in ("/sandboxes", "/v2/sandboxes"):
        # sandbox_create.go:219-228,355-356.
        _add(spec, "post", path, "400", "invalidAutoPausePolicy", "autoPauseMemory=false only applies when autoPause is true.", "Filesystem-only auto-pause was requested without enabling auto-pause")
        _add(spec, "post", path, "500", "volumeConversionFailed", "failed to convert volume mounts", "Resolving requested volume mounts fails")

    # Template parsing: handlers below call shared/pkg/id/id.go:41-45,94-136.
    for path in ("/templates/{templateID}", "/v2/templates/{templateID}"):
        _add(spec, "patch", path, "400", "invalidTemplateId", "Invalid template ID: invalid template ID: invalid!", "The template ID contains an unsupported character")
        _add(spec, "patch", path, "404", "templateNotFound", "Template 'my-template' not found or you don't have access to it", "The template is missing or inaccessible during the update")
    _add(spec, "get", "/templates/aliases/{alias}", "400", "invalidAlias", "Invalid alias format: invalid template ID: invalid!", "The alias contains an unsupported character")
    _add(spec, "get", "/templates/{templateID}/tags", "400", "invalidTemplateReference", "Invalid template reference: invalid template ID: invalid!", "The template reference contains an unsupported character")
    for method, path in (("delete", "/templates/{templateID}"), ("delete", "/templates/tags")):
        # resolveTemplateAndTeam -> cache/templates/errors.go:64-66.
        _add(spec, method, path, "404", "templateNotFound", "template 'my-template' not found", "The template reference cannot be resolved")
    _add(spec, "post", "/templates/tags", "404", "templateTagNotFound", "Template 'my-template' with tag 'default' not found", "The target template tag is missing")
    _add(spec, "post", "/v3/templates", "400", "nameRequired", "Name is required", "Neither name nor the deprecated alias was supplied")
    # template/register_build.go:212-215.
    _add(spec, "post", "/v3/templates", "409", "clusterChanged", "The team's cluster changed; retry the template build request", "The team's cluster changed during template registration")
    # volume_create.go:153, with a valid name so the OpenAPI pattern check passes.
    _add(spec, "post", "/volumes", "400", "volumeNameExists", "Volume with name 'my-volume' already exists", "A volume with this name already exists")
    _add(spec, "get", "/sandboxes/metrics", "400", "tooManySandboxes", "Too many sandboxes requested, maximum is 100", "The request contains more than 100 sandbox IDs")
    # team_metrics*.go -> clickhouse/pkg/utils/validate.go:21-23.
    for path in ("/teams/{teamID}/metrics", "/teams/{teamID}/metrics/max"):
        _add(spec, "get", path, "400", "invalidTimeRange", "start time cannot be after end time", "The start timestamp is later than the end timestamp")
    _add(spec, "get", "/events/sandboxes", "400", "invalidEventType", "Invalid event type: bogus.event", "An unrecognized event type was supplied")
    # spec/openapi.yml declares limit >= 1 for the sandbox-specific events route.
    # main.go:199-213 + utils/error.go:118-126,137-153 wrap that parameter failure.
    _add(spec, "get", "/events/sandboxes/{sandboxID}", "400", "invalidLimit", 'validation error: error in openapi3filter.RequestError: parameter "limit" in query has an error: number must be at least 1', "The limit query parameter is below 1")
    # The generated DB queries return Scan's error unchanged:
    # packages/db/queries/get_template.sql.go:60-70 and get_template_build.sql.go:33-75.
    # API's pinned pgx v5.10.0 defines the no-row text and returns it from Scan:
    # https://github.com/jackc/pgx/blob/v5.10.0/conn.go#L107
    # https://github.com/jackc/pgx/blob/v5.10.0/rows.go#L109-L111
    for method, path in (("get", "/templates/{templateID}/files/{hash}"), ("post", "/v2/templates/{templateID}/builds/{buildID}")):
        _add(spec, method, path, "404", "templateRowNotFound", "Error when getting template: no rows in result set", "The template or template/build pair has no database row")


def _correct_unreachable_response_bodies(spec: dict) -> None:
    # Local resources never return 404 for historical queries, and the remote
    # adapter maps non-400 edge failures to 500, not 404:
    # clusters/resources_local.go:116-238; resources_remote.go:38-58,110-132,222-253.
    # Template build lookup is 400 when missing, not 404, while its remaining
    # handler/helper errors are 400/403/500:
    # handlers/template_build_status.go:25-128; template_build_logs.go:18-104.
    for path in ("/sandboxes/{sandboxID}/logs", "/v2/sandboxes/{sandboxID}/logs",
                 "/sandboxes/{sandboxID}/metrics", "/templates/{templateID}/builds/{buildID}/status",
                 "/templates/{templateID}/builds/{buildID}/logs"):
        op = _operation(spec, "get", path)
        if op is not None:
            op.get("responses", {}).pop("404", None)
    # Secret backend errors map to 502/504 (handlers/secrets.go:347-405).
    # Its remaining generic 500 is panic recovery, which writes no body:
    # https://github.com/gin-gonic/gin/blob/v1.12.0/recovery.go#L109-L110
    for method, path in HANDLER_STATUSES:
        if path != "/secrets" and not path.startswith("/secrets/"):
            continue
        op = _operation(spec, method, path)
        if op is not None and "500" in op.get("responses", {}):
            response = _response(spec, op, "500")
            response.pop("content", None)
            response["description"] = "Unexpected internal failure. Panic recovery returns HTTP 500 without a response body. Secrets-backend failures use 502 or 504."
    op = _operation(spec, "get", "/teams/{teamID}/metrics")
    if op is not None and "500" in op.get("responses", {}):
        # handlers/team_metrics.go:57-60 wraps the dynamic error returned by
        # clickhouse/pkg/team.go:57-85. Do not invent a concrete database error.
        _response(spec, op, "500")["description"] = "The team-metrics query failed. The message starts with `error querying team metrics: ` followed by the underlying query error."


def _response_code_examples(spec: dict) -> None:
    """Use each HTTP status as its code example without narrowing the schema."""
    for method, path in HANDLER_STATUSES:
        op = _operation(spec, method, path)
        if op is None:
            continue
        for status in list(op.get("responses", {})):
            if not status.isdigit() or int(status) < 400:
                continue
            response = _response(spec, op, status)
            media = response.get("content", {}).get("application/json", {})
            schema = media.get("schema")
            if not schema:
                continue
            schema = _resolved_copy(spec, schema)
            code = schema.get("properties", {}).get("code")
            if code is not None:
                code["example"] = int(status)
                media["schema"] = schema


def _webhook_requests(spec: dict) -> None:
    # Event set: SOURCE_ROOT + packages/shared/pkg/events/sandbox.go:23-38.
    # Secret length: live boundary on 2026-09-23. Create: 31 chars -> 400,
    # 32 chars -> 201. Update: 31 chars -> 400, 32 chars -> 200 in three rounds.
    schemas = spec.get("components", {}).get("schemas", {})
    events = ["sandbox.lifecycle." + event for event in ("created", "killed", "paused", "resumed", "updated", "checkpointed")]
    for name in ("WebhookCreate", "WebhookConfiguration"):
        if name not in schemas:
            continue
        schema = schemas[name] = deepcopy(schemas[name])
        properties = schema.get("properties", {})
        if "signatureSecret" in properties:
            properties["signatureSecret"].setdefault("minLength", 32)
            properties["signatureSecret"].setdefault("example", "replace-with-your-random-signing-secret")
        if "events" in properties:
            properties["events"].setdefault("items", {}).setdefault("enum", events.copy())
            properties["events"].setdefault("example", ["sandbox.lifecycle.created"])



def _template_list_resources(spec: dict) -> None:
    # SOURCE_ROOT + packages/db/queries/get_team_templates.sql:4-5 and
    # packages/db/queries/get_team_templates_with_cursor.sql:19-20 COALESCE
    # missing build resources to zero. templates_list.go:74-75 and
    # templates_list_v2.go:103-104 return those values without input validation.
    # Only Template responses use these unions. Build requests keep CPUCount
    # >= 1 and MemoryMB >= 128, and we do not extrapolate to TemplateBuild.
    schemas = spec.get("components", {}).get("schemas", {})
    if "Template" not in schemas:
        return
    template = schemas["Template"] = deepcopy(schemas["Template"])
    zero = {"type": "integer", "const": 0}
    for field in ("cpuCount", "memoryMB"):
        prop = template.get("properties", {}).get(field)
        if prop is None or zero in prop.get("anyOf", []):
            continue
        template["properties"][field] = {
            "description": "Resource allocation for the latest build, or 0 when build resources are unavailable.",
            "anyOf": [prop, deepcopy(zero)],
        }

def apply_platform_response_fixes(spec: dict[str, Any]) -> None:
    """Supplement public platform operations after path filtering, in place."""
    for (method, path), statuses in HANDLER_STATUSES.items():
        op = _operation(spec, method, path)
        if op is None:
            continue
        for status in statuses:
            _response(spec, op, status)
        _shared_errors(spec, method, path, op)
        if path == "/secrets" or path.startswith("/secrets/"):
            _secret_errors(spec, op)
        if path.startswith("/events/"):
            _event_errors(spec, method, path, op)
    _specific_errors(spec)
    _remaining_handler_examples(spec)
    _correct_unreachable_response_bodies(spec)
    _response_code_examples(spec)
    # packages/api/internal/handlers/template_update.go:25-61: legacy update emits JSON null, v2 emits names.
    legacy = _operation(spec, "patch", "/templates/{templateID}")
    if legacy is not None:
        success = _response(spec, legacy, "200")
        success["content"] = {"application/json": {"schema": {"type": "null"}, "example": None}}
    _webhook_requests(spec)
    _template_list_resources(spec)
