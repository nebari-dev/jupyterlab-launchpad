import asyncio
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Event
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from tornado.testing import AsyncHTTPTestCase, gen_test
from tornado.web import Application, RequestHandler
from traitlets.config import Config

from jupyterlab_launchpad.handlers import NebiActionHandler, NebiRepairStatusHandler


class TestActionHandler(NebiActionHandler):
    def get_current_user(self):
        return "test-user"

    def check_xsrf_cookie(self):
        pass


class PingHandler(RequestHandler):
    def get(self):
        self.write("ok")


class NebiActionTestCase(AsyncHTTPTestCase):
    def get_app(self):
        self.temporary = TemporaryDirectory()
        self.workspace = Path(self.temporary.name)
        (self.workspace / "pixi.toml").write_text('[workspace]\nname="concurrency"\n')
        server = SimpleNamespace(root_dir=str(self.workspace), config=Config())
        return Application([
            ("/action", TestActionHandler, {"action": "install-dependencies", "server_app": server}),
            ("/ping", PingHandler),
        ], cookie_secret="test")

    def tearDown(self):
        super().tearDown()
        self.temporary.cleanup()


class TestRepairStatusHandler(NebiRepairStatusHandler):
    def get_current_user(self):
        return SimpleNamespace(username=self.request.headers.get('X-Test-User', 'test-user'))


class TestRepairActionHandler(TestActionHandler):
    def get_current_user(self):
        return SimpleNamespace(username=self.request.headers.get('X-Test-User', 'test-user'))


class NebiRepairLifetimeTests(NebiActionTestCase):
    def get_app(self):
        app = super().get_app()
        app.settings['base_url'] = '/'
        server = SimpleNamespace(root_dir=str(self.workspace), config=Config(), local_url='http://127.0.0.1:8888')
        self.repair_server = server
        app.add_handlers('.*$', [
            ('/repair', TestRepairActionHandler, {'action': 'repair', 'server_app': server}),
            ('/repair/([a-f0-9]{32})', TestRepairStatusHandler),
        ])
        return app

    @gen_test
    async def test_rejected_submission_releases_workspace_for_fresh_attempt(self):
        from jupyterlab_launchpad.nebi_repair import NebiRepair

        async def solve(worker):
            worker.path = 'workspaces/test'
            return await worker.run_job('solve')

        with patch.object(NebiRepair, 'run', solve), patch(
                'jupyterlab_launchpad.handlers.AsyncHTTPClient') as client:
            async def submit():
                response = await self.http_client.fetch(self.get_url('/repair'), method='POST',
                    body=json.dumps({'workspacePath': str(self.workspace), 'repair': True}))
                identifier = json.loads(response.body)['id']
                operation = self._app.settings['launchpad_nebi_repairs'][identifier]
                await asyncio.wait_for(operation['task'], 2)
                return identifier, operation

            jobs = SimpleNamespace(code=200, body=b'[]')
            for rejection, message in [
                (SimpleNamespace(code=403, body=b'<html>Rejected</html>'), '403'),
                (SimpleNamespace(code=429, body=b'<html>Rejected</html>'), '429'),
                (ConnectionRefusedError(), 'refused'),
            ]:
                with self.subTest(message=message):
                    client.return_value.fetch = AsyncMock(side_effect=[
                        jobs, rejection,
                        jobs, SimpleNamespace(code=202, body=b'{"id":"accepted","status":"completed"}'),
                    ])
                    first, rejected = await submit()
                    self.assertEqual(rejected['status'], 'failed')
                    self.assertIn(message, rejected['error'])
                    second, retried = await submit()
                    self.assertNotEqual(first, second)
                    self.assertEqual(retried['status'], 'completed')

    @gen_test
    async def test_outside_root_validation_does_not_block_and_still_rejects_unlisted_paths(self):
        started, release = Event(), Event()
        browser_root = self.workspace / 'browser'
        browser_root.mkdir()
        unlisted = self.workspace / 'unlisted'
        unlisted.mkdir()
        def discover():
            started.set()
            release.wait(3)
            return {'test': {'spec': {'metadata': {'nebi_workspace_path': str(self.workspace)}}}}
        self.repair_server.root_dir = str(browser_root)
        self.repair_server.kernel_spec_manager = SimpleNamespace(get_all_specs=discover)
        with patch('jupyterlab_launchpad.handlers._run_command', return_value={'ok': True}), patch(
                'jupyterlab_launchpad.handlers.NebiRepair') as coordinator:
            coordinator.return_value.run = AsyncMock()
            body = {'workspacePath': str(self.workspace), 'repair': True}
            action = self.http_client.fetch(self.get_url('/repair'), method='POST',
                body=json.dumps(body), headers={'Content-Type': 'application/json'})
            try:
                self.assertTrue(await asyncio.get_running_loop().run_in_executor(None, started.wait, 2))
                ping = await self.http_client.fetch(self.get_url('/ping'))
                self.assertEqual(ping.code, 200)
                self.assertFalse(action.done(), 'Path validation blocked the event loop')
            finally:
                release.set()
                response = await action
            self.assertEqual(response.code, 202)
            operation = self._app.settings['launchpad_nebi_repairs'][json.loads(response.body)['id']]
            await operation['task']
            self.assertEqual(operation['status'], 'completed')
            body['workspacePath'] = str(unlisted)
            rejected = await self.http_client.fetch(self.get_url('/repair'), method='POST',
                body=json.dumps(body), headers={'Content-Type': 'application/json'}, raise_error=False)
            self.assertEqual(rejected.code, 400)
            coordinator.return_value.run.assert_awaited_once()

    @gen_test
    async def test_owner_retry_replaces_expired_credentials_without_resubmitting_job(self):
        from jupyterlab_launchpad.nebi_repair import NebiRepair
        polls = []
        submissions = 0
        async def native_fetch(request, **kwargs):
            nonlocal submissions
            if request.url.endswith('/jobs'):
                data, code = [], 200
            elif request.method == 'POST':
                submissions += 1
                data, code = {'id': 'native-job', 'status': 'running'}, 200
            else:
                polls.append({key.lower(): value for key, value in request.headers.items()})
                if request.headers.get('Cookie') == 'session=fresh' and 'Authorization' not in request.headers:
                    data, code = {'id': 'native-job', 'status': 'completed'}, 200
                else:
                    data, code = {'error': 'Expired test credentials'}, 403
            return SimpleNamespace(body=json.dumps(data).encode(), code=code)
        def coordinator(workspace, prepare, request, command, run_json, wait_for_retry):
            worker = NebiRepair(workspace, prepare, request, command, run_json, wait_for_retry)
            worker.path = 'workspaces/test'
            worker.run = lambda: worker.run_job('solve')
            return worker
        async def submit(headers):
            return await self.http_client.fetch(self.get_url('/repair'), method='POST',
                body=json.dumps({'workspacePath': str(self.workspace), 'repair': True}),
                headers={'Content-Type': 'application/json', **headers}, raise_error=False)
        with patch('jupyterlab_launchpad.handlers.AsyncHTTPClient') as client, patch(
                'jupyterlab_launchpad.handlers.NebiRepair', side_effect=coordinator):
            client.return_value.fetch = AsyncMock(side_effect=native_fetch)
            first = await submit({'Authorization': 'token expired', 'Cookie': 'session=expired', 'X-XSRFToken': 'expired'})
            identifier = json.loads(first.body)['id']
            operation = self._app.settings['launchpad_nebi_repairs'][identifier]
            try:
                while operation['status'] == 'running':
                    await asyncio.sleep(.01)
                self.assertEqual(operation['status'], 'needs_attention')
                old_headers = dict(operation['headers'])
                other = await submit({'X-Test-User': 'another-user', 'Cookie': 'session=other'})
                self.assertEqual(other.code, 409)
                self.assertEqual(operation['headers'], old_headers)
                resumed = await submit({'Cookie': 'session=fresh', 'X-XSRFToken': 'fresh'})
                self.assertEqual(json.loads(resumed.body)['id'], identifier)
                await asyncio.wait_for(asyncio.shield(operation['task']), 2)
                self.assertEqual(operation['status'], 'completed')
                self.assertEqual(submissions, 1)
                self.assertEqual(len(polls), 2)
                self.assertEqual(polls[0]['authorization'], 'token expired')
                self.assertNotIn('authorization', polls[1])
                self.assertEqual(polls[1]['cookie'], 'session=fresh')
                self.assertEqual(polls[1]['x-xsrftoken'], 'fresh')
                self.assertEqual(polls[1]['host'], self.get_url('/').split('/')[2])
            finally:
                if not operation['task'].done():
                    operation['task'].cancel()
                    try:
                        await operation['task']
                    except asyncio.CancelledError:
                        pass

    @gen_test
    async def test_repair_outlives_submission_and_duplicate_click_rejoins(self):
        started, release, finished = asyncio.Event(), asyncio.Event(), asyncio.Event()
        async def repair():
            started.set()
            await release.wait()
            finished.set()
        with patch('jupyterlab_launchpad.handlers.NebiRepair') as coordinator:
            coordinator.return_value.run = AsyncMock(side_effect=repair)
            async def submit(user='test-user'):
                return await self.http_client.fetch(self.get_url('/repair'), method='POST',
                    body=json.dumps({'workspacePath': str(self.workspace), 'repair': True}),
                    headers={'Content-Type': 'application/json', 'X-Test-User': user}, raise_error=False)
            first = await submit()
            self.assertEqual(first.code, 202)
            operation = json.loads(first.body)['id']
            await started.wait()
            # The initiating HTTP request is already finished; no browser polling
            # is necessary to keep the operation alive.
            second = await submit()
            self.assertEqual(json.loads(second.body)['id'], operation)
            other = await submit('another-user')
            self.assertEqual(other.code, 409)
            other_status = await self.http_client.fetch(self.get_url('/repair/' + operation),
                headers={'X-Test-User': 'another-user'}, raise_error=False)
            self.assertEqual(other_status.code, 404)
            ping = await self.http_client.fetch(self.get_url('/ping'))
            self.assertEqual(ping.code, 200)
            release.set()
            await finished.wait()
            status = await self.http_client.fetch(self.get_url('/repair/' + operation))
            self.assertEqual(json.loads(status.body)['status'], 'completed')
            coordinator.return_value.run.assert_awaited_once()

    @gen_test
    async def test_poll_timeout_keeps_repair_owned_until_native_completion(self):
        from tornado.httpclient import HTTPClientError
        from jupyterlab_launchpad.nebi_repair import NebiRepair
        failed_poll, release = asyncio.Event(), asyncio.Event()
        polls = 0
        async def native_request(path, method='GET'):
            nonlocal polls
            if path == 'jobs':
                return []
            if method == 'POST':
                return {'id': 'native-job', 'status': 'pending'}
            polls += 1
            if polls == 1:
                failed_poll.set()
                raise HTTPClientError(599, 'Timeout')
            await release.wait()
            return {'id': 'native-job', 'status': 'completed'}
        original_sleep = asyncio.sleep
        async def fast_sleep(seconds):
            await original_sleep(0)
        async def run():
            worker = NebiRepair(self.workspace, None, native_request, None, None)
            worker.path = 'workspaces/test'
            return await worker.run_job('solve')
        with patch('jupyterlab_launchpad.handlers.NebiRepair') as coordinator, patch(
                'jupyterlab_launchpad.nebi_repair.asyncio.sleep', side_effect=fast_sleep):
            coordinator.return_value.run = AsyncMock(side_effect=run)
            async def submit():
                response = await self.http_client.fetch(self.get_url('/repair'), method='POST',
                    body=json.dumps({'workspacePath': str(self.workspace), 'repair': True}),
                    headers={'Content-Type': 'application/json'})
                return json.loads(response.body)
            first = await submit()
            await failed_poll.wait()
            second = await submit()
            self.assertEqual(first['id'], second['id'])
            status = await self.http_client.fetch(self.get_url('/repair/' + first['id']))
            self.assertEqual(json.loads(status.body)['status'], 'running')
            release.set()
            await self._app.settings['launchpad_nebi_repairs'][first['id']]['task']
            status = await self.http_client.fetch(self.get_url('/repair/' + first['id']))
            self.assertEqual(json.loads(status.body)['status'], 'completed')
            coordinator.return_value.run.assert_awaited_once()

    @gen_test
    async def test_attention_reserves_only_affected_workspace_and_retry_resumes(self):
        from jupyterlab_launchpad.nebi_repair import NebiRepair
        from tornado.web import HTTPError
        lookup_fails = True
        submissions = 0
        async def native_request(path, method='GET'):
            nonlocal submissions
            if path == 'jobs':
                return []
            if method == 'POST':
                submissions += 1
                return {'id': 'native-job', 'status': 'running'}
            if lookup_fails:
                raise HTTPError(404, log_message='missing job')
            return {'id': 'native-job', 'status': 'completed'}
        def coordinator(workspace, prepare, request, command, run_json, wait_for_retry):
            worker = NebiRepair(workspace, prepare, native_request, command, run_json, wait_for_retry)
            worker.path = 'workspaces/test'
            worker.run = lambda: worker.run_job('solve')
            return worker
        other = self.workspace / 'other'
        other.mkdir()
        (other / 'pixi.toml').write_text('[workspace]\nname="other"\n')
        with patch('jupyterlab_launchpad.handlers.NebiRepair', side_effect=coordinator), patch(
                'jupyterlab_launchpad.handlers._run_command', return_value={'ok': True}):
            async def submit():
                response = await self.http_client.fetch(self.get_url('/repair'), method='POST',
                    body=json.dumps({'workspacePath': str(self.workspace), 'repair': True}),
                    headers={'Content-Type': 'application/json'})
                return json.loads(response.body)
            first = await submit()
            operation = self._app.settings['launchpad_nebi_repairs'][first['id']]
            while operation['status'] == 'running':
                await asyncio.sleep(.01)
            self.assertEqual(operation['status'], 'needs_attention')
            unrelated = await self.http_client.fetch(self.get_url('/action'), method='POST',
                body=json.dumps({'workspacePath': str(other)}), headers={'Content-Type': 'application/json'})
            self.assertEqual(unrelated.code, 200)
            same = await self.http_client.fetch(self.get_url('/action'), method='POST',
                body=json.dumps({'workspacePath': str(self.workspace)}), headers={'Content-Type': 'application/json'}, raise_error=False)
            self.assertEqual(same.code, 409)
            lookup_fails = False
            second = await submit()
            self.assertEqual(first['id'], second['id'])
            await operation['task']
            self.assertEqual(operation['status'], 'completed')
            self.assertEqual(submissions, 1)
