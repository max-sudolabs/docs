"""Generator regressions and sanitized live response contract fixtures.

Fixtures were captured against managed E2B on 2026-09-23 (envd 0.6.10).
They are offline examples, not a claim to exercise every server error branch.
"""
import copy
import json
from pathlib import Path
import sys
import unittest

import yaml
from jsonschema import Draft202012Validator, RefResolver
from openapi_spec_validator import OpenAPIV31SpecValidator

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
import generate_openapi_reference as generator


def resolve(spec, value):
    while "$ref" in value:
        current = spec
        for segment in value["$ref"][2:].split("/"):
            current = current[segment.replace("~1", "/").replace("~0", "~")]
        value = current
    return value


class GeneratorTests(unittest.TestCase):
    def test_error_response_and_bodyless_success_survive(self):
        error = {"description": "Connect error", "content": {"application/json": {
            "schema": {"$ref": "#/components/schemas/ConnectError"}}}}
        spec = {"paths": {"/rpc": {"post": {"responses": {
            "200": {"description": "No body"}, "default": error}}}},
            "components": {"schemas": {"ConnectError": {"type": "object"}}}}
        original = copy.deepcopy(spec)
        generator.preserve_response_contracts(spec)
        generator.remove_orphaned_schemas(spec)
        self.assertEqual(original, spec)

    def test_protobuf_union_accepts_one_arm_and_rejects_unknown_fields(self):
        spec = {"components": {"schemas": {"Selector": {
            "type": "object", "additionalProperties": False,
            "oneOf": [{"properties": {"pid": {"type": "integer"}}, "required": ["pid"]},
                      {"properties": {"tag": {"type": "string"}}, "required": ["tag"]}]}}}}
        generator.fix_union_schemas(spec)
        validator = Draft202012Validator(spec["components"]["schemas"]["Selector"])
        for value in [{"pid": 123}, {"tag": "example"}]:
            self.assertTrue(validator.is_valid(value))
        for value in [{}, {"pid": 123, "tag": "example"}, {"pid": 123, "unknown": 1}]:
            self.assertFalse(validator.is_valid(value))

    def test_excluded_auth_never_becomes_anonymous(self):
        spec = {"paths": {
            "/teams": {"get": {"security": [{"AuthProviderBearerAuth": []}]}},
            "/public": {"get": {"security": []}},
            "/mixed": {"get": {"security": [{"AdminAuth": []}, {"ApiKeyAuth": []}]}}},
            "components": {"securitySchemes": {"AuthProviderBearerAuth": {}, "ApiKeyAuth": {}}}}
        generator.filter_paths(spec)
        self.assertNotIn("/teams", spec["paths"])
        self.assertEqual([], spec["paths"]["/public"]["get"]["security"])
        self.assertEqual([{"ApiKeyAuth": []}], spec["paths"]["/mixed"]["get"]["security"])


class GeneratedSpecTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = yaml.safe_load((SCRIPTS.parent / "openapi-public.yaml").read_text())

    def test_openapi_and_local_references_are_valid(self):
        OpenAPIV31SpecValidator(self.spec).validate()
        def walk(value):
            if isinstance(value, dict):
                if "$ref" in value:
                    resolve(self.spec, value)
                for child in value.values():
                    walk(child)
            elif isinstance(value, list):
                for child in value:
                    walk(child)
        walk(self.spec)

    def test_recorded_live_responses_match_published_contracts(self):
        cases = json.loads((SCRIPTS / "tests/fixtures/live-responses.json").read_text())
        for case in cases:
            with self.subTest(operation=case["operation"], status=case["status"]):
                method, path = case["operation"].split(" ", 1)
                responses = self.spec["paths"][path][method.lower()]["responses"]
                self.assertIn(str(case["status"]), responses, "Live status must be explicit")
                response = resolve(self.spec, responses[str(case["status"])])
                if case["status"] in [204, 304] or case.get("no_body"):
                    self.assertNotIn("content", response)
                    continue
                if "body" not in case:
                    continue
                content = response.get("content", {})
                media = content.get(case["content_type"], content.get("*/*"))
                self.assertIsNotNone(media, "Actual response media type must be represented")
                Draft202012Validator(media["schema"], resolver=RefResolver.from_schema(self.spec)).validate(case["body"])

    def test_transport_constants_and_framed_examples(self):
        self.assertNotIn("/teams", self.spec["paths"])
        for path in generator.STREAMING_ENDPOINTS:
            item = self.spec["paths"][path]
            self.assertEqual("https://sandbox.e2b.app", item["servers"][0]["url"])
            op = item["post"]
            params = {p.get("name"): p for p in op["parameters"]}
            self.assertEqual("1", params["Connect-Protocol-Version"]["example"])
            self.assertEqual(49983, params["E2b-Sandbox-Port"]["example"])
            sample = op["x-codeSamples"][0]["source"]
            compile(sample, path, "exec")
            self.assertIn('struct.pack(">BI", 0, len(payload))', sample)
            self.assertIn('message.get("error")', sample)

    def test_list_sandboxes_errors_have_renderable_examples(self):
        for path in ("/sandboxes", "/v2/sandboxes"):
            for status in ("400", "500"):
                with self.subTest(path=path, status=status):
                    response = resolve(self.spec, self.spec["paths"][path]["get"]["responses"][status])
                    media = response["content"]["application/json"]
                    examples = media.get("examples", {})
                    self.assertTrue(examples, "Mintlify otherwise renders code: 123 and message: <string>")
                    values = [example["value"] for example in examples.values()]
                    for value in values:
                        self.assertEqual(value["code"], int(status))
                        self.assertNotIn("<string>", value["message"])
                        self.assertNotIn("error_code", value, "These handler examples omit the optional error_code")
                    if status == "500":
                        self.assertIn({"code": 500, "message": "Error when getting sandboxes"}, values)

    def test_all_response_examples_match_their_schemas(self):
        for path, item in self.spec["paths"].items():
            for method in generator._HTTP_METHODS:
                for status, raw in item.get(method, {}).get("responses", {}).items():
                    response = resolve(self.spec, raw)
                    for content_type, media in response.get("content", {}).items():
                        examples = list(media.get("examples", {}).values())
                        if "example" in media:
                            examples.append({"value": media["example"]})
                        for example in examples:
                            if "value" not in example:
                                continue
                            with self.subTest(path=path, method=method, status=status, content_type=content_type):
                                Draft202012Validator(media["schema"], resolver=RefResolver.from_schema(self.spec)).validate(example["value"])

    def test_json_error_example_coverage(self):
        missing = set()
        for path, item in self.spec["paths"].items():
            for method in generator._HTTP_METHODS:
                for status, raw in item.get(method, {}).get("responses", {}).items():
                    if not str(status).startswith(("4", "5")):
                        continue
                    response = resolve(self.spec, raw)
                    for content_type, media in response.get("content", {}).items():
                        if "json" not in content_type:
                            continue
                        if not media.get("examples") and "example" not in media:
                            missing.add((method, path, status))
        # This handler passes through the underlying ClickHouse query error.
        # Its verified message prefix is documented, without inventing a suffix.
        self.assertEqual(missing, {("get", "/teams/{teamID}/metrics", "500")})

    def test_optional_basic_user_and_exit_code(self):
        op = self.spec["paths"]["/process.Process/Start"]["post"]
        self.assertIn({"SandboxAccessTokenAuth": []}, op["security"])
        field = self.spec["components"]["schemas"]["process.ProcessEvent.EndEvent"]["properties"]["exitCode"]
        self.assertFalse(field.get("deprecated", False))
        Draft202012Validator(field).validate(7)


if __name__ == "__main__":
    unittest.main()
