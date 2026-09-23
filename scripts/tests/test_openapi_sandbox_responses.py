"""Regression checks against sanitized payloads captured from live envd."""

import copy
import pathlib
import sys
import unittest

from jsonschema import Draft202012Validator, ValidationError

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from openapi_sandbox_responses import (  # noqa: E402
    STREAMING, UNARY_CODES, apply_sandbox_response_fixes,
)


def fixture():
    paths = {}
    for name in UNARY_CODES:
        paths['/' + name] = {'post': {'responses': {
            '200': {'description': 'Success', 'content': {'application/json': {'schema': {'type': 'object'}}}},
            'default': {'description': 'Additional Connect errors', 'content': {'application/json': {'schema': {'type': 'object'}}}},
        }}}
    for path in STREAMING:
        paths[path] = {'post': {
            'requestBody': {'content': {'application/connect+json': {'schema': {'type': 'object'}, 'example': {'process': {'pid': 42}}}}},
            'responses': {'200': {'description': 'Stream', 'content': {
                'application/connect+json': {'schema': {'type': 'object'}}
            }}}
        }}
    for path in ['/health', '/metrics', '/envs']:
        paths[path] = {'get': {'responses': {'204' if path == '/health' else '200': {'description': 'Success'}}}}
    paths['/files'] = {'get': {'responses': {'200': {'description': 'File'}}}, 'post': {'responses': {'200': {'description': 'Uploaded'}}}}
    paths['/sandboxes'] = {'get': {'responses': {'200': {'description': 'Platform operation'}}}}
    return {'openapi': '3.1.0', 'paths': paths, 'components': {'schemas': {}}}


class SandboxResponseTests(unittest.TestCase):
    def setUp(self):
        self.spec = fixture()
        self.paths = set(self.spec['paths']) - {'/sandboxes'}
        apply_sandbox_response_fixes(self.spec, self.paths)

    def validate(self, schema, instance):
        Draft202012Validator({**schema, 'components': self.spec['components']}).validate(instance)

    def response(self, path, status, method='post'):
        return self.spec['paths'][path][method]['responses'][str(status)]

    def test_actual_unary_payloads_validate(self):
        observed = [
            ('/filesystem.Filesystem/MakeDir', 409, {'code': 'already_exists', 'message': 'directory already exists: /tmp'}),
            ('/filesystem.Filesystem/ListDir', 400, {'code': 'invalid_argument', 'message': 'path is not a directory: /etc/hostname'}),
            ('/filesystem.Filesystem/Stat', 404, {'code': 'not_found', 'message': 'file not found: lstat /tmp/missing: no such file or directory'}),
            ('/process.Process/SendSignal', 404, {'code': 'not_found', 'message': 'process with pid 2147483647 not found'}),
            ('/process.Process/CloseStdin', 501, {'code': 'unimplemented', 'message': 'invalid input type *process.ProcessSelector'}),
            ('/process.Process/Update', 500, {'code': 'internal', 'message': 'error resizing tty: tty not assigned to process'}),
        ]
        for path, status, payload in observed:
            with self.subTest(path=path, status=status):
                self.validate(self.response(path, status)['content']['application/json']['schema'], payload)

    def test_every_unary_error_media_has_a_concrete_message_example(self):
        # Guards against the renderer inventing {code: 123, message: "<string>"}
        # for an explicit error response that has only a generic schema.
        for endpoint in UNARY_CODES:
            responses = self.spec['paths']['/' + endpoint]['post']['responses']
            for status, response in responses.items():
                if not status.isdigit() or int(status) < 400:
                    continue
                media = response.get('content', {}).get('application/json')
                if media is None:
                    continue
                with self.subTest(endpoint=endpoint, status=status):
                    self.assertTrue(media.get('examples'))
                    for example in media['examples'].values():
                        self.assertTrue(example['value'].get('message'))
                        self.assertNotEqual(example['value'].get('code'), 123)
                        self.assertNotIn('<string>', example['value']['message'])

    def test_defined_messages_and_error_conditions_are_preserved(self):
        observed = {
            '/filesystem.Filesystem/CreateWatcher': ('internal', 'error statting path /etc/hostname/child: stat /etc/hostname/child: not a directory'),
            '/filesystem.Filesystem/ListDir': ('internal', 'error resolving symlink: not a directory'),
            '/filesystem.Filesystem/MakeDir': ('internal', 'error getting file info: stat /etc/hostname/child: not a directory'),
            '/filesystem.Filesystem/Remove': ('internal', 'error removing file or directory: unlinkat /etc/hostname/child: not a directory'),
            '/filesystem.Filesystem/Stat': ('internal', 'error getting file info: lstat /etc/hostname/child: not a directory'),
            '/process.Process/CloseStdin': ('unknown', 'error closing stdin: cannot close stdin for PTY process — send Ctrl+D (0x04) instead'),
            '/process.Process/SendInput': ('internal', 'error writing to stdin: stdin not enabled or closed'),
            '/process.Process/SendSignal': ('internal', 'error sending signal: os: process already finished'),
        }
        for path, (code, message) in observed.items():
            with self.subTest(path=path):
                example = self.response(path, 500)['content']['application/json']['examples'][code]
                self.assertEqual(example['value'], {'code': code, 'message': message})
        race = self.response('/filesystem.Filesystem/MakeDir', 404)['content']['application/json']['examples']['not_found']
        self.assertIn('disappeared', race['summary'])

    def test_auth_layers_accept_both_envelopes(self):
        schema = self.response('/process.Process/List', 401)['content']['application/json']['schema']
        self.validate(schema, {'code': 401, 'message': 'unauthorized access, please provide a valid access token or method signing if supported'})
        self.validate(schema, {'code': 'unauthenticated', 'message': "invalid username: 'nonexistent'"})
        self.assertNotIn('401', self.spec['paths']['/health']['get']['responses'])

    def test_routing_failures_are_not_connect_json(self):
        path = '/process.Process/List'
        self.validate(self.response(path, 400)['content']['text/plain']['schema'], 'missing header\n')
        self.validate(self.response(path, 500)['content']['text/plain']['schema'], 'Unexpected error when routing request: invalid sandbox port\n')
        schema = self.response(path, 502)['content']['application/json']['schema']
        self.validate(schema, {'sandboxId': 'example', 'message': 'The sandbox was not found', 'code': 502})
        with self.assertRaises(ValidationError):
            self.validate(schema, {'sandboxID': 'example', 'message': 'The sandbox was not found', 'code': 502})

    def test_stream_failures_are_http_200_terminal_frames(self):
        for path in STREAMING:
            response = self.response(path, 200)
            media = response['content']['application/connect+json']
            self.assertEqual(media['schema'], {'type': 'string', 'format': 'binary'})
            self.validate(media['x-connect-end-stream-schema'], {'error': {'code': 'not_found', 'message': 'process with pid 2147483647 not found'}})
            self.validate(media['x-connect-end-stream-schema'], {})
            self.validate(media['x-connect-end-stream-schema'], {'metadata': {'trailer': ['one', 'two']}})
            self.assertIn('flags=2', response['description'])
            self.assertIn('Decoded terminal error example', response['description'])
            self.assertNotIn('404', self.spec['paths'][path]['post']['responses'])
            self.assertNotIn('429', self.spec['paths'][path]['post']['responses'])

    def test_stream_requests_describe_framed_bytes(self):
        for path in STREAMING:
            request = self.spec['paths'][path]['post']['requestBody']
            media = request['content']['application/connect+json']
            self.assertEqual(media['schema'], {'type': 'string', 'format': 'binary'})
            self.assertEqual(media['x-connect-message-schema'], {'type': 'object'})
            self.assertNotIn('example', media)
            self.assertIn('flags byte 0', request['description'])
            self.assertIn('four big-endian bytes', request['description'])

    def test_files_range_and_conditional_responses(self):
        partial = self.response('/files', 206, 'get')
        self.assertEqual(partial['content']['*/*']['schema']['format'], 'binary')
        self.assertEqual(partial['headers']['Content-Range']['schema']['example'], 'bytes 2-5/10')
        self.assertNotIn('content', self.response('/files', 304, 'get'))
        invalid = self.response('/files', 416, 'get')
        self.validate(invalid['content']['text/plain']['schema'], 'invalid range: failed to overlap\n')
        self.assertNotIn('application/json', invalid['content'])
        self.assertEqual(invalid['headers']['Content-Range']['schema']['example'], 'bytes */10')
        self.assertNotIn('206', self.spec['paths']['/files']['post']['responses'])

    def test_upload_json_text_uses_a_string_wire_schema(self):
        media = self.response('/files', 200)['content']['text/plain']
        value = '[{"name":"example.txt","path":"/tmp/example.txt","type":"file"}]'
        self.validate(media['schema'], value)
        with self.assertRaises(ValidationError):
            self.validate(media['schema'], [{'name': 'example.txt'}])

    def test_upstream_error_schema_can_overlap_the_overlay(self):
        spec = fixture()
        op = spec['paths']['/process.Process/List']['post']
        op['responses']['400'] = {'description': 'Upstream validation error', 'content': {
            'application/json': {'schema': {'type': 'object', 'required': ['code'], 'properties': {'code': {'type': 'string'}}}}
        }}
        apply_sandbox_response_fixes(spec, self.paths)
        self.spec = spec
        self.validate(op['responses']['400']['content']['application/json']['schema'], {'code': 'invalid_argument', 'message': 'bad request'})

    def test_only_reachable_application_statuses_added(self):
        for path in ['/process.Process/List', '/filesystem.Filesystem/Remove']:
            self.assertNotIn('404', self.spec['paths'][path]['post']['responses'])
        self.assertNotIn('501', self.spec['paths']['/filesystem.Filesystem/MakeDir']['post']['responses'])
        self.assertIn('default', self.spec['paths']['/process.Process/List']['post']['responses'])
        self.assertTrue(self.response('/metrics', 500, 'get')['x-empty-body-allowed'])

    def test_overlay_is_idempotent_and_does_not_touch_platform(self):
        before = copy.deepcopy(self.spec)
        apply_sandbox_response_fixes(self.spec, self.paths)
        self.assertEqual(self.spec, before)
        self.assertEqual(self.spec['paths']['/sandboxes'], fixture()['paths']['/sandboxes'])

    def test_shared_source_response_aliases_do_not_leak(self):
        spec = fixture()
        shared = {'200': {'description': 'Success'}}
        spec['paths']['/metrics']['get']['responses'] = shared
        spec['paths']['/envs']['get']['responses'] = shared
        apply_sandbox_response_fixes(spec, self.paths)
        self.assertEqual(shared, {'200': {'description': 'Success'}})
        self.assertNotIn('x-empty-body-allowed', spec['paths']['/envs']['get']['responses']['500'])
        spec['paths']['/metrics']['get']['responses']['401']['content']['application/json']['examples'].clear()
        self.assertTrue(spec['paths']['/envs']['get']['responses']['401']['content']['application/json']['examples'])

    def test_all_named_json_examples_match_their_schema(self):
        for path in self.paths:
            for method in ['get', 'post']:
                for response in self.spec['paths'][path].get(method, {}).get('responses', {}).values():
                    for media in response.get('content', {}).values():
                        for example in media.get('examples', {}).values():
                            self.validate(media['schema'], example['value'])


if __name__ == '__main__':
    unittest.main()
