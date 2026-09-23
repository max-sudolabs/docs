"""Source-backed response overlays for the public envd API.

Verified against infra 0c21aa2277b59a1d040761ed3fbbb29a78775470 and live
requests on 2026-09-23. Handler failures and proxy failures are separate layers.
These overlays can be removed as the upstream contracts acquire the same detail.
"""

import json
from copy import deepcopy
from typing import Any

SOURCE = "https://github.com/e2b-dev/infra/blob/0c21aa2277b59a1d040761ed3fbbb29a78775470/"
CONNECT_SOURCE = "https://github.com/connectrpc/connect-go/blob/v1.18.1/protocol_connect.go"
METHODS = ("get", "post", "put", "patch", "delete", "head", "options")
STREAMING = {
    "/process.Process/Start", "/process.Process/Connect",
    "/process.Process/StreamInput", "/filesystem.Filesystem/WatchDir",
}

# Only handler-reachable codes are assigned to individual unary operations.
# Shared protocol validation (400) and username authentication (401) are added
# separately. This is intentionally NOT the entire Connect code/status table.
# Sources: packages/envd/internal/services/{filesystem,process}/ below.
UNARY_CODES = {
    "filesystem.Filesystem/CreateWatcher": ("invalid_argument", "not_found", "internal"),
    "filesystem.Filesystem/GetWatcherEvents": ("not_found", "internal"),
    "filesystem.Filesystem/ListDir": ("invalid_argument", "not_found", "failed_precondition", "internal"),
    "filesystem.Filesystem/MakeDir": ("invalid_argument", "already_exists", "not_found", "internal"),
    "filesystem.Filesystem/Move": ("invalid_argument", "not_found", "internal"),
    "filesystem.Filesystem/Remove": ("invalid_argument", "internal"),
    "filesystem.Filesystem/RemoveWatcher": ("not_found",),
    "filesystem.Filesystem/Stat": ("invalid_argument", "not_found", "internal"),
    "process.Process/CloseStdin": ("not_found", "unimplemented", "unknown"),
    "process.Process/List": (),
    "process.Process/SendInput": ("not_found", "unimplemented", "internal"),
    "process.Process/SendSignal": ("not_found", "unimplemented", "internal"),
    "process.Process/Update": ("not_found", "unimplemented", "internal"),
}
HTTP_CODE = {
    "invalid_argument": "400", "failed_precondition": "400", "unauthenticated": "401",
    "not_found": "404", "already_exists": "409", "internal": "500",
    "unknown": "500", "unimplemented": "501",
}
HANDLER_SOURCES = {
    "CreateWatcher": "filesystem/watch_sync.go#L150",
    "GetWatcherEvents": "filesystem/watch_sync.go#L201",
    "ListDir": "filesystem/dir.go#L17",
    "MakeDir": "filesystem/dir.go#L56",
    "Move": "filesystem/move.go#L15",
    "Remove": "filesystem/remove.go#L14",
    "RemoveWatcher": "filesystem/watch_sync.go#L232",
    "Stat": "filesystem/stat.go#L12",
    "CloseStdin": "process/input.go#L86",
    "List": "process/list.go#L12",
    "SendInput": "process/input.go#L14",
    "SendSignal": "process/signal.go#L13",
    "Update": "process/update.go#L13",
}
# Sanitized concrete examples from source and the live negative-response audit.
EXAMPLES = {
    "CreateWatcher": {
        "not_found": "path /tmp/missing not found: stat /tmp/missing: no such file or directory",
        "internal": "error statting path /etc/hostname/child: stat /etc/hostname/child: not a directory",
    },
    "GetWatcherEvents": {
        "not_found": "watcher with id does-not-exist not found",
        "internal": "watcher error channel closed",
    },
    "ListDir": {
        "invalid_argument": "path is not a directory: /etc/hostname",
        "failed_precondition": 'cyclic symlink or chain >255 links at "/tmp/loop"',
        "not_found": "path not found: lstat /tmp/missing: no such file or directory",
        "internal": "error resolving symlink: not a directory",
    },
    "MakeDir": {
        "already_exists": "directory already exists: /tmp",
        "invalid_argument": "path already exists but it is not a directory: /etc/hostname",
        "not_found": "file not found: lstat /tmp/example: no such file or directory",
        "internal": "error getting file info: stat /etc/hostname/child: not a directory",
    },
    "Move": {
        "not_found": "source file not found: rename /tmp/missing /tmp/destination: no such file or directory",
        "internal": "error renaming: rename /home/user /home/user: file exists",
    },
    "Remove": {
        "internal": "error removing file or directory: unlinkat /etc/hostname/child: not a directory",
    },
    "RemoveWatcher": {"not_found": "watcher with id does-not-exist not found"},
    "Stat": {
        "not_found": "file not found: lstat /tmp/missing: no such file or directory",
        "internal": "error getting file info: lstat /etc/hostname/child: not a directory",
    },
    "CloseStdin": {
        "unknown": "error closing stdin: cannot close stdin for PTY process — send Ctrl+D (0x04) instead",
    },
    "SendInput": {"internal": "error writing to stdin: stdin not enabled or closed"},
    "SendSignal": {"internal": "error sending signal: os: process already finished"},
    "Update": {"internal": "error resizing tty: tty not assigned to process"},
}

# Source-only conditions, not claims that these rare/runtime branches were
# reproduced. Filesystem non-directory-parent examples above and ListDir404
# were additionally captured from live envd on 2026-09-23.
# GetWatcherEvents: filesystem/watch_sync.go:70,221-222.
# MakeDir: filesystem/dir.go:85-93 -> filesystem/utils.go:43-50.
# CloseStdin/SendInput: process/input.go:24-26,96-97 ->
# process/handler/handler.go:494-518.
# SendSignal: process/signal.go:32-34 -> handler/handler.go:465-483 ->
# https://github.com/golang/go/blob/go1.26.8/src/os/exec.go#L17-L19
# https://github.com/golang/go/blob/go1.26.8/src/os/exec_unix.go#L92-L118
EXAMPLE_SUMMARIES = {
    ("GetWatcherEvents", "internal"): "The watcher's error channel closed unexpectedly",
    ("MakeDir", "not_found"): "The new directory disappeared before its entry information was read",
    ("CloseStdin", "unknown"): "Closing stdin is not supported for a PTY process",
    ("SendInput", "internal"): "The process has stdin disabled or already closed",
    ("SendSignal", "internal"): "The process exited after lookup but before the signal was delivered",
}



def _ref(name: str) -> dict[str, str]:
    return {"$ref": f"#/components/schemas/{name}"}


def _append_description(response: dict, text: str) -> None:
    description = response.get("description", "")
    if text not in description:
        response["description"] = f"{description} {text}".strip()


def _media(response: dict, media_type: str, schema: dict) -> dict:
    media = response.setdefault("content", {}).setdefault(media_type, {})
    existing = media.get("schema")
    if existing is None:
        media["schema"] = deepcopy(schema)
    elif existing != schema and schema not in existing.get("anyOf", []):
        if "anyOf" in existing:
            existing["anyOf"].append(deepcopy(schema))
        else:
            media["schema"] = {"anyOf": [existing, deepcopy(schema)]}
    # OpenAPI disallows example alongside examples. Preserve upstream examples.
    if "example" in media:
        media.setdefault("examples", {})["upstream"] = {"value": media.pop("example")}
    return media


def _example(media: dict, name: str, value: Any, summary: str) -> None:
    media.setdefault("examples", {})[name] = {"summary": summary, "value": deepcopy(value)}


def _add_schemas(spec: dict) -> None:
    schemas = spec.setdefault("components", {}).setdefault("schemas", {})
    schemas["EnvdHTTPError"] = {
        "type": "object", "required": ["code", "message"],
        "properties": {"code": {"type": "integer"}, "message": {"type": "string"}},
        "description": "HTTP error from envd, with a numeric status code. Distinct from a Connect RPC error.",
    }
    schemas["ConnectRPCError"] = {
        "type": "object", "required": ["code"],
        "properties": {
            "code": {"type": "string", "description": "Connect error code, such as not_found or invalid_argument."},
            "message": {"type": "string"},
            "details": {"type": "array", "items": {
                "type": "object", "properties": {
                    "type": {"type": "string"}, "value": {"type": "string", "format": "byte"},
                    "debug": {},
                },
            }},
        },
        "description": "Connect JSON error. The code is a string, unlike envd's numeric HTTP errors.",
    }
    schemas["ConnectEndStreamResponse"] = {
        "type": "object",
        "description": "Decoded JSON payload of the final Connect frame (flags byte 2). An absent error indicates successful completion.",
        "properties": {
            "error": _ref("ConnectRPCError"),
            "metadata": {"type": "object", "additionalProperties": {"type": "array", "items": {"type": "string"}}},
        },
    }
    schemas["SandboxRoutingError"] = {
        "type": "object", "required": ["sandboxId", "message", "code"],
        "properties": {"sandboxId": {"type": "string"}, "message": {"type": "string"}, "code": {"type": "integer"}},
    }


def _shared_responses(op: dict, path: str) -> None:
    responses = op.setdefault("responses", {})
    # shared/pkg/proxy/handler.go and proxy/template/sandbox_not_found.go.
    for status, description, name, text in (
        ("400", "The sandbox proxy rejects missing or invalid routing information.", "missingRoutingHeader", "missing header\n"),
        ("500", "The sandbox proxy encountered an unexpected routing error.", "routingFailure", "Unexpected error when routing request: invalid sandbox port\n"),
    ):
        response = responses.setdefault(status, {"description": ""})
        _append_description(response, description)
        media = _media(response, "text/plain", {"type": "string"})
        _example(media, name, text, description)
    # Always replace the previous generator's sandboxID spelling.
    responses["502"] = {
        "description": "The sandbox proxy could not find the sandbox. Browser navigation may receive an HTML error page.",
        "content": {
            "application/json": {"schema": _ref("SandboxRoutingError"), "examples": {
                "sandboxNotFound": {"value": {"sandboxId": "sandbox-id", "message": "The sandbox was not found", "code": 502}},
            }},
            "text/html": {"schema": {"type": "string"}},
        },
    }
    if path == "/health":
        return
    response = responses.setdefault("401", {"description": ""})
    _append_description(response, "Sandbox access-token or signature authentication failed.")
    # Files already have the equivalent upstream Error schema. Use that schema
    # rather than duplicating two overlapping numeric envelopes.
    media = response.setdefault("content", {}).get("application/json")
    if media is None:
        media = _media(response, "application/json", _ref("EnvdHTTPError"))
    elif "example" in media:
        media.setdefault("examples", {})["upstream"] = {"value": media.pop("example")}
    message = "missing signature query parameter" if path == "/files" else "unauthorized access, please provide a valid access token or method signing if supported"
    _example(media, "sandboxAuthentication", {"code": 401, "message": message}, "Missing or invalid sandbox credentials")


def _unary_responses(op: dict, path: str) -> None:
    name = path.rsplit("/", 1)[1]
    responses = op["responses"]
    codes = tuple(dict.fromkeys(("invalid_argument", "unauthenticated") + UNARY_CODES[path.lstrip("/")]))
    for code in codes:
        response = responses.setdefault(HTTP_CODE[code], {"description": ""})
        _append_description(response, f"Connect RPC error: {code}.")
        media = _media(response, "application/json", _ref("ConnectRPCError"))
        message = EXAMPLES.get(name, {}).get(code)
        if code == "invalid_argument" and message is None:
            message = 'Connect-Protocol-Version must be "1": got "invalid"'
        if code == "unauthenticated":
            message = "invalid username: 'nonexistent'"
        if path.startswith("/process.Process/"):
            if code == "not_found":
                message = "process with pid 2147483647 not found"
            elif code == "unimplemented":
                message = "invalid input type *process.ProcessSelector"
        if message is not None:
            _example(media, code, {"code": code, "message": message}, EXAMPLE_SUMMARIES.get((name, code), f"Example {code} response"))
    op["x-response-contract-source"] = SOURCE + "packages/envd/internal/services/" + HANDLER_SOURCES[name]


def _streaming_response(op: dict, path: str) -> None:
    request = op.get("requestBody")
    if request is not None:
        request_content = request.setdefault("content", {})
        request_media = request_content.pop("application/json", None) or request_content.setdefault("application/connect+json", {})
        if "x-connect-message-schema" not in request_media and "schema" in request_media:
            request_media["x-connect-message-schema"] = deepcopy(request_media["schema"])
        request_media["schema"] = {"type": "string", "format": "binary"}
        # Schema examples remain available on the decoded component. A bare JSON
        # media example would misleadingly look like an executable request body.
        request_media.pop("example", None)
        request_media.pop("examples", None)
        request_content["application/connect+json"] = request_media
        logical_ref = request_media.get("x-connect-message-schema", {}).get("$ref", "the decoded request schema")
        _append_description(request, "Send Connect-framed bytes with Content-Type application/connect+json. Each uncompressed request frame begins with flags byte 0, then the JSON payload length as four big-endian bytes, then the UTF-8 JSON payload. The decoded payload follows `" + logical_ref + "` (x-connect-message-schema). Sending a bare JSON document does not encode a valid Connect request frame.")
    response = op["responses"]["200"]
    content = response.setdefault("content", {})
    media = content.pop("application/json", None) or content.setdefault("application/connect+json", {})
    if "x-connect-message-schema" not in media and "schema" in media:
        media["x-connect-message-schema"] = deepcopy(media["schema"])
    media["schema"] = {"type": "string", "format": "binary"}
    media["x-connect-end-stream-schema"] = _ref("ConnectEndStreamResponse")
    media["x-connect-decoded-examples"] = {
        "completed": {"flags": 2, "payload": {}},
        "failed": {"flags": 2, "payload": {"error": {
            "code": "not_found" if path != "/process.Process/Start" else "invalid_argument",
            "message": "process with pid 2147483647 not found" if path.startswith("/process.") and path != "/process.Process/Start"
            else ("cwd '/tmp/missing' does not exist" if path == "/process.Process/Start"
                  else "path /tmp/missing not found: stat /tmp/missing: no such file or directory"),
        }}},
    }
    content["application/connect+json"] = media
    decoded_error = media["x-connect-decoded-examples"]["failed"]["payload"]
    _append_description(response, "Decoded terminal error example (the wire also includes the five-byte frame prefix): " + "`" + json.dumps(decoded_error, separators=(",", ":")) + "`.")
    _append_description(response, "Connect-framed bytes, not an ordinary JSON document. Each frame has a one-byte flags field and a four-byte big-endian payload length. The decoded data payload follows x-connect-message-schema. The final frame has flags=2 and follows x-connect-end-stream-schema. RPC failures appear in its error object while the HTTP status remains 200. Authentication or routing failures before the stream can use the separate HTTP responses below.")
    op["x-response-contract-source"] = CONNECT_SOURCE + "#L1203-L1308"


def _file_responses(op: dict) -> None:
    responses = op["responses"]
    headers = {
        "Accept-Ranges": {"schema": {"type": "string", "example": "bytes"}},
        "Last-Modified": {"schema": {"type": "string"}, "description": "File modification time as an HTTP date."},
        "Content-Length": {"schema": {"type": "integer"}, "description": "Response length when known."},
    }
    responses["200"].setdefault("headers", {}).update(deepcopy(headers))
    _append_description(responses["200"], "The Content-Type depends on the file. A gzip response uses the file extension's media type, or application/octet-stream as fallback.")
    responses["200"]["content"] = {"*/*": {"schema": {"type": "string", "format": "binary"}}}
    responses["206"] = {
        "description": "Partial file content for a satisfiable Range request. Content-Type depends on the file, or is multipart/byteranges for multiple ranges.",
        "headers": {**deepcopy(headers), "Content-Range": {
            "description": "Range returned for a single-range response.",
            "schema": {"type": "string", "example": "bytes 2-5/10"},
        }},
        "content": {"*/*": {"schema": {"type": "string", "format": "binary"}}},
    }
    responses["304"] = {
        "description": "The file has not changed according to the conditional request. No response body.",
        "headers": {"Last-Modified": deepcopy(headers["Last-Modified"])},
    }
    responses["416"] = {
        "description": "The requested byte range is invalid or does not overlap the file. This is a plain-text error from the file server.",
        "headers": {"Content-Range": {"description": "File length for an unsatisfiable range.", "schema": {"type": "string", "example": "bytes */10"}}},
        "content": {"text/plain": {"schema": {"type": "string"}, "examples": {
            "rangeDoesNotOverlap": {"value": "invalid range: failed to overlap\n"},
        }}},
    }
    response = responses.setdefault("406", {"description": "No acceptable transfer encoding."})
    media = response.setdefault("content", {}).setdefault("application/json", {"schema": _ref("EnvdHTTPError")})
    media.pop("example", None)  # Old hard-coded text did not match the handler.
    media["examples"] = {
        "unsupportedEncoding": {"value": {"code": 406, "message": "error parsing Accept-Encoding: no acceptable encoding found, supported: [gzip]"}},
        "rangeRequiresIdentity": {"value": {"code": 406, "message": "identity encoding not acceptable for Range or conditional request"}},
    }
    for name, description, example in (
        ("Range", "Byte range to download.", "bytes=2-5"),
        ("If-Modified-Since", "Return 304 if the file has not changed since this HTTP date.", "Tue, 01 Jan 2030 00:00:00 GMT"),
        ("Accept-Encoding", "Supported transfer encodings include gzip and identity. Range and conditional requests require acceptable identity encoding.", "identity"),
    ):
        parameters = op.setdefault("parameters", [])
        if not any(p.get("name") == name and p.get("in") == "header" for p in parameters):
            parameters.append({"name": name, "in": "header", "description": description, "schema": {"type": "string"}, "example": example})
    op["x-response-contract-source"] = SOURCE + "packages/envd/internal/api/download.go#L19-L184"


def _upload_response(op: dict) -> None:
    # upload.go marshals JSON bytes but does not set Content-Type. Go's content
    # sniffing reports text/plain (confirmed by live uploads on 2026-09-23).
    response = op["responses"].get("200")
    if response is None:
        return
    content = response.setdefault("content", {})
    media = content.setdefault("text/plain", {"schema": {"type": "string"}})
    if "application/json" in content:
        media["x-decoded-schema"] = deepcopy(content["application/json"]["schema"])
    _example(media, "uploadedFile", '[{"name":"example.txt","path":"/tmp/example.txt","type":"file"}]', "JSON text describing the uploaded file")
    _append_description(response, "The response contains serialized JSON. Current envd also serves these bytes as text/plain, so parse the text as JSON to read the upload entries.")
    op["x-response-contract-source"] = SOURCE + "packages/envd/internal/api/upload.go#L345-L358"


def apply_sandbox_response_fixes(spec: dict[str, Any], envd_paths: set[str]) -> None:
    """Augment surviving envd paths without changing platform operations."""
    if not envd_paths.intersection(spec.get("paths", {})):
        return
    _add_schemas(spec)
    for path in sorted(envd_paths):
        path_item = spec.get("paths", {}).get(path, {})
        for method in METHODS:
            op = path_item.get(method)
            if not isinstance(op, dict):
                continue
            # Upstream YAML can alias response objects across different routes.
            op["responses"] = deepcopy(op.get("responses", {}))
            _shared_responses(op, path)
            if path.lstrip("/") in UNARY_CODES:
                _unary_responses(op, path)
            elif path in STREAMING:
                _streaming_response(op, path)
            elif path == "/files" and method == "get":
                _file_responses(op)
            elif path == "/files" and method == "post":
                _upload_response(op)
            elif path == "/metrics" and method == "get":
                # store.go GetMetrics writes 500 with no body on metrics failure.
                _append_description(op["responses"]["500"], "Metrics collection can also fail with an empty body.")
                op["responses"]["500"]["x-empty-body-allowed"] = True
