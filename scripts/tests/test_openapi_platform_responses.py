"""Response regressions use payloads observed in the 2026-09-23 API audit."""

from copy import deepcopy
from pathlib import Path
import sys
import unittest

import yaml
from jsonschema import Draft202012Validator, ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from openapi_platform_responses import apply_platform_response_fixes, HANDLER_STATUSES


class PlatformResponsesTest(unittest.TestCase):
    def setUp(self):
        # Exercise the overlay with real source contracts and refs, not a second
        # copy of its status table. Works before and after specs are regenerated.
        self.spec = yaml.safe_load((Path(__file__).resolve().parents[2] / "openapi-public.yaml").read_text())

    def response(self, method, path, status):
        return self.spec["paths"][path][method]["responses"][str(status)]

    def assert_accepts(self, method, path, status, payload):
        schema = self.response(method, path, status)["content"]["application/json"]["schema"]
        # Attach components so the response's local refs resolve naturally.
        validator = Draft202012Validator({**schema, "components": self.spec["components"]})
        validator.validate(payload)

    def test_observed_missing_statuses_accept_actual_payloads(self):
        apply_platform_response_fixes(self.spec)
        for method, path, status, payload in [
            ("get", "/sandboxes/{sandboxID}", 400, {"code": 400, "message": "Invalid sandbox ID"}),
            ("get", "/snapshots", 400, {"code": 400, "message": "Invalid next token"}),
            ("get", "/templates/{templateID}/builds/{buildID}/status", 400,
             {"code": 400, "message": "Build 'c038add6-557f-463e-9fdd-cf2c129e4c76' not found"}),
            ("get", "/templates/{templateID}/builds/{buildID}/logs", 400,
             {"code": 400, "message": "Build 'c038add6-557f-463e-9fdd-cf2c129e4c76' not found"}),
            ("get", "/volumes/{volumeID}", 400, {"code": 400, "message": "Invalid volume ID"}),
            ("get", "/events/webhooks/{webhookID}/stats", 400,
             {"code": 400, "message": "Stats range must be 7 days or less"}),
        ]:
            with self.subTest(method=method, path=path):
                self.assert_accepts(method, path, status, payload)

    def test_legacy_null_and_v2_object_are_distinct(self):
        before_v2 = deepcopy(self.response("patch", "/v2/templates/{templateID}", 200))
        apply_platform_response_fixes(self.spec)
        self.assert_accepts("patch", "/templates/{templateID}", 200, None)
        self.assertEqual(self.response("patch", "/v2/templates/{templateID}", 200), before_v2)
        self.assert_accepts("patch", "/v2/templates/{templateID}", 200, {"names": ["my-template"]})
        with self.assertRaises(ValidationError):
            self.assert_accepts("patch", "/templates/{templateID}", 200, {"names": []})

    def test_shared_refs_headers_examples_and_default_are_preserved(self):
        shared = {"description": "Upstream validation", "headers": {"X-Trace": {"schema": {"type": "string"}}},
                  "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"},
                                                    "example": {"code": 400, "message": "Source example"}}}}
        self.spec["components"]["responses"]["TestShared"] = shared
        for path in ("/snapshots", "/v2/sandboxes"):
            self.spec["paths"][path]["get"]["responses"]["400"] = {"$ref": "#/components/responses/TestShared"}
        sentinel = {"description": "Retain upstream default", "content": {"text/plain": {"schema": {"type": "string"}}}}
        self.spec["paths"]["/snapshots"]["get"]["responses"]["default"] = sentinel
        apply_platform_response_fixes(self.spec)
        self.assertEqual(shared["content"]["application/json"]["example"]["message"], "Source example")
        self.assertNotIn("examples", shared["content"]["application/json"])
        result = self.response("get", "/snapshots", 400)
        self.assertEqual(result["headers"], shared["headers"])
        self.assertEqual(result["content"]["application/json"]["examples"]["upstream"]["value"], shared["content"]["application/json"]["example"])
        result["headers"]["X-Trace"]["description"] = "Only this operation"
        self.assertNotIn("description", self.response("get", "/v2/sandboxes", 400)["headers"]["X-Trace"])
        self.assertEqual(self.response("get", "/snapshots", "default"), sentinel)

    def test_secret_examples_distinguish_layers_and_do_not_leak(self):
        apply_platform_response_fixes(self.spec)
        result = self.response("get", "/secrets/{secretID}", 404)
        examples = result["content"]["application/json"]["examples"]
        self.assertEqual(examples["secretNotFound"]["value"], {"code": 404, "message": "Secret not found"})
        self.assertEqual(examples["preHandlerNotFound"]["value"], {"code": 404, "message": "Not found"})
        self.assertEqual(result["headers"]["Cache-Control"]["schema"]["enum"], ["no-store"])
        other = self.response("get", "/volumes/{volumeID}", 404)
        self.assertNotIn("secretNotFound", other["content"]["application/json"].get("examples", {}))
        auth = self.response("get", "/secrets", 401)["content"]["application/json"]["examples"]
        self.assertEqual(auth["secretsUnauthorized"]["value"]["message"], "You are not authenticated")
        self.assertNotIn("missingAuthentication", auth)

    def test_blocked_and_banned_have_different_route_scopes(self):
        apply_platform_response_fixes(self.spec)
        read = self.response("get", "/sandboxes", 403)["content"]["application/json"]["examples"]
        create = self.response("post", "/sandboxes", 403)["content"]["application/json"]["examples"]
        self.assertIn("teamBanned", read)
        self.assertNotIn("teamBlocked", read)
        self.assertEqual(create["teamBlocked"]["value"], {"code": 403, "message": "team is blocked"})

    def test_no_webhook_mapper_status_inflation(self):
        apply_platform_response_fixes(self.spec)
        for method, path in [("get", "/events/webhooks"), ("get", "/events/webhooks/{webhookID}"), ("delete", "/events/webhooks/{webhookID}")]:
            responses = self.spec["paths"][path][method]["responses"]
            self.assertNotIn("400", responses)
            self.assertNotIn("429", responses)
            self.assertIn("503", responses)
            self.assertIn("504", responses)

    def test_webhook_inputs_have_usable_constraints_and_examples(self):
        apply_platform_response_fixes(self.spec)
        schema = self.spec["components"]["schemas"]["WebhookCreate"]
        value = {"name": "Example", "url": "https://example.com/webhook", "events": ["sandbox.lifecycle.created"], "signatureSecret": "x" * 32}
        validator = Draft202012Validator(schema)
        validator.validate(value)
        with self.assertRaises(ValidationError):
            validator.validate({**value, "signatureSecret": "x" * 31})
        with self.assertRaises(ValidationError):
            validator.validate({**value, "events": ["string"]})

    def test_webhook_update_secret_boundary_matches_live_responses(self):
        apply_platform_response_fixes(self.spec)
        validator = Draft202012Validator(self.spec["components"]["schemas"]["WebhookConfiguration"])
        validator.validate({"signatureSecret": "x" * 32})
        validator.validate({"enabled": False})
        with self.assertRaises(ValidationError):
            validator.validate({"signatureSecret": "x" * 31})
        response = self.response("patch", "/events/webhooks/{webhookID}", 400)
        example = response["content"]["application/json"]["examples"]["signingSecretTooShort"]
        self.assertEqual(example["value"], {
            "code": 400, "message": "Webhook secret must be at least 32 characters long",
        })

    def test_zero_resources_are_valid_only_in_template_list_responses(self):
        before_cpu = deepcopy(self.spec["components"]["schemas"]["CPUCount"])
        before_memory = deepcopy(self.spec["components"]["schemas"]["MemoryMB"])
        apply_platform_response_fixes(self.spec)
        schemas = self.spec["components"]["schemas"]
        for name, field, valid_value in (("CPUCount", "cpuCount", 2), ("MemoryMB", "memoryMB", 512)):
            response = Draft202012Validator({**schemas["Template"]["properties"][field], "components": self.spec["components"]})
            response.validate(0)
            response.validate(valid_value)
            with self.assertRaises(ValidationError):
                response.validate(-1)
            with self.assertRaises(ValidationError):
                Draft202012Validator(schemas[name]).validate(0)
        self.assertEqual(schemas["CPUCount"], before_cpu)
        self.assertEqual(schemas["MemoryMB"], before_memory)

    def test_every_json_error_has_a_source_message_or_explicit_dynamic_exception(self):
        apply_platform_response_fixes(self.spec)
        missing = set()
        for method, path in HANDLER_STATUSES:
            for status, response in self.spec["paths"][path][method]["responses"].items():
                if not status.isdigit() or int(status) < 400:
                    continue
                media = response.get("content", {}).get("application/json")
                if media is None:
                    continue
                if not media.get("examples") and "example" not in media:
                    missing.add((method, path, status))
                code = media["schema"].get("properties", {}).get("code")
                if code is not None:
                    self.assertEqual(code.get("example"), int(status), (method, path, status))
        self.assertEqual(missing, {("get", "/teams/{teamID}/metrics", "500")})
        self.assertIn("underlying query error", self.response("get", "/teams/{teamID}/metrics", 500)["description"])

    def test_stale_not_found_and_bodyless_secret_recovery(self):
        apply_platform_response_fixes(self.spec)
        for path in ("/sandboxes/{sandboxID}/logs", "/v2/sandboxes/{sandboxID}/logs",
                     "/sandboxes/{sandboxID}/metrics", "/templates/{templateID}/builds/{buildID}/status",
                     "/templates/{templateID}/builds/{buildID}/logs"):
            self.assertNotIn("404", self.spec["paths"][path]["get"]["responses"])
        for method, path in (("get", "/secrets"), ("post", "/secrets"),
                             ("get", "/secrets/{secretID}"), ("post", "/secrets/{secretID}"),
                             ("delete", "/secrets/{secretID}")):
            self.assertNotIn("content", self.response(method, path, 500))
            self.assertIn("Cache-Control", self.response(method, path, 500)["headers"])

    def test_idempotent_and_preserves_unrelated_surface(self):
        envd = {path: deepcopy(item) for path, item in self.spec["paths"].items() if path.startswith(("/process.", "/filesystem.")) or path in ("/files", "/health")}
        apply_platform_response_fixes(self.spec)
        once = deepcopy(self.spec)
        apply_platform_response_fixes(self.spec)
        self.assertEqual(self.spec, once)
        for path, item in envd.items():
            self.assertEqual(self.spec["paths"][path], item)


if __name__ == "__main__":
    unittest.main()
