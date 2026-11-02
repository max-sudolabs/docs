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

    def test_unstable_paths_are_excluded(self):
        spec = {"paths": {
            "/unstable/templates/search": {"get": {"security": [{"ApiKeyAuth": []}]}},
            "/templates": {"get": {"security": [{"ApiKeyAuth": []}]}}},
            "components": {"securitySchemes": {"ApiKeyAuth": {}}}}
        generator.filter_paths(spec)
        self.assertEqual(["/templates"], list(spec["paths"]))

    def test_parameters_and_schemas_only_excluded_routes_use_are_removed(self):
        ref = lambda kind, name: {"$ref": f"#/components/{kind}/{name}"}
        spec = {"paths": {
            "/unstable/builds": {"get": {"security": [{"ApiKeyAuth": []}],
                                         "parameters": [ref("parameters", "buildStatuses")]}},
            "/templates": {"get": {"security": [{"ApiKeyAuth": []}],
                                   "parameters": [ref("parameters", "limit")]}}},
            "components": {"securitySchemes": {"ApiKeyAuth": {}},
                           "parameters": {
                               "limit": {"name": "limit", "in": "query", "schema": {"type": "integer"}},
                               "buildStatuses": {"name": "statuses", "in": "query", "schema": {
                                   "type": "array", "items": ref("schemas", "BuildStatus")}}},
                           "schemas": {"BuildStatus": {"type": "string"}}}}
        generator.filter_paths(spec)
        generator.remove_orphaned_parameters(spec)
        generator.remove_orphaned_schemas(spec)
        self.assertEqual(["limit"], list(spec["components"]["parameters"]))
        self.assertEqual({}, spec["components"]["schemas"])

    def test_error_codes_only_excluded_routes_return_are_stripped(self):
        description = (
            "Machine-readable semantic error code. Not a closed set; initial values: "
            "sandbox_create_refused (no retry changes it, such as a bad vcpu count), "
            "secret_limit_reached, cluster_assignment_invalid, cluster_assignment_cluster_deleting.")
        error_code = {"type": "string", "description": description}
        spec = {"paths": {
            "/unstable/management/clusters/{clusterID}/deletion": {"put": {
                "security": [{"AdminApiKeyAuth": []}],
                "description": "Returns 409 with error_code cluster_assignment_cluster_deleting."}},
            "/secrets": {"post": {"security": [{"ApiKeyAuth": []}],
                "description": "Returns 409 with error_code secret_limit_reached.",
                "responses": {"409": {"content": {"application/json": {"schema": {
                    "properties": {"error_code": dict(error_code)}}}}}}}}},
            "components": {"securitySchemes": {"ApiKeyAuth": {}},
                           "schemas": {"Error": {"properties": {"error_code": error_code}}}}}
        removed = generator.filter_paths(spec)
        codes = generator.internal_error_codes(spec, removed)
        self.assertEqual({"cluster_assignment_invalid", "cluster_assignment_cluster_deleting"}, codes)
        generator.strip_error_codes(spec, codes)
        expected = (
            "Machine-readable semantic error code. Not a closed set; initial values: "
            "sandbox_create_refused (no retry changes it, such as a bad vcpu count), "
            "secret_limit_reached.")
        inline = spec["paths"]["/secrets"]["post"]["responses"]["409"]["content"]["application/json"]
        self.assertEqual(expected, spec["components"]["schemas"]["Error"]["properties"]["error_code"]["description"])
        self.assertEqual(expected, inline["schema"]["properties"]["error_code"]["description"])

    def test_unreleased_cap_sentences_are_removed(self):
        spec = {"paths": {
            "/sandboxes": {"get": {"description": "List all running sandboxes. Returns 400 when more than "
                                                  "5000 running sandboxes match; use GET /v2/sandboxes to page through them."}},
            "/templates": {"get": {"description": "List all templates. Returns 400 when the team has more than "
                                                  "5000 templates; use /v2/templates to page through them."}}}}
        generator.remove_unreleased_descriptions(spec)
        self.assertEqual("List all running sandboxes.", spec["paths"]["/sandboxes"]["get"]["description"])
        self.assertEqual("List all templates.", spec["paths"]["/templates"]["get"]["description"])


    def test_nullable_is_replaced_everywhere(self):
        spec = {"components": {"schemas": {
            "Mcp": {"type": "object", "additionalProperties": {}, "nullable": True},
            "Sandbox": {"type": "object", "properties": {
                "mcp": {"$ref": "#/components/schemas/Mcp", "nullable": True},
                "name": {"type": "string", "nullable": True},
                "nullable": {"type": "boolean"}}}}}}
        self.assertEqual(3, generator.replace_nullable(spec))
        schemas = spec["components"]["schemas"]
        self.assertEqual(["object", "null"], schemas["Mcp"]["type"])
        props = schemas["Sandbox"]["properties"]
        self.assertEqual([{"$ref": "#/components/schemas/Mcp"}, {"type": "null"}], props["mcp"]["oneOf"])
        self.assertEqual(["string", "null"], props["name"]["type"])
        self.assertEqual({"type": "boolean"}, props["nullable"])


class GeneratedSpecTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = yaml.safe_load((SCRIPTS.parent / "openapi-public.yaml").read_text())

    def test_no_internal_or_unreleased_surface(self):
        text = yaml.dump(self.spec)
        for code in ("cluster_registration_", "cluster_assignment_"):
            self.assertNotIn(code, text)
        for code in ("sandbox_capacity_unavailable", "secret_limit_reached", "idempotency_request_mismatch"):
            self.assertIn(code, text)
        parameters = self.spec["components"].get("parameters", {})
        for name in ("buildIDs", "buildStatuses", "buildsCursor", "buildsLimit", "buildIDOrTemplate"):
            self.assertNotIn(name, parameters)
        self.assertNotIn("BuildStatus", self.spec["components"]["schemas"])
        for path in ("/sandboxes", "/templates"):
            self.assertNotIn("5000", self.spec["paths"][path]["get"].get("description", ""))

    def test_no_openapi_30_nullable_keyword(self):
        found = []
        def walk(value, path):
            if isinstance(value, dict):
                if isinstance(value.get("nullable"), bool):
                    found.append(path)
                for key, child in value.items():
                    walk(child, f"{path}/{key}")
            elif isinstance(value, list):
                for i, child in enumerate(value):
                    walk(child, f"{path}/{i}")
        walk(self.spec, "#")
        self.assertEqual([], found)

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
