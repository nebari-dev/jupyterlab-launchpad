import asyncio
import json
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import threading
from types import SimpleNamespace
from unittest.mock import patch

from jupyter_server.auth import AllowAllAuthorizer
from jupyter_server.auth.identity import IdentityProvider
from tornado.testing import AsyncHTTPTestCase, gen_test
from tornado.web import Application
from traitlets.config import Config

from jupyterlab_launchpad.handlers import NebiActionHandler, setup_handlers


class NebiConcurrencyTests(AsyncHTTPTestCase):
    def get_app(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name).resolve()
        self.root = self.base / "root"
        self.root.mkdir()
        app = Application(
            [],
            identity_provider=IdentityProvider(token="test-token"),
            authorizer=AllowAllAuthorizer(),
            cookie_secret="test-secret",
            allow_remote_access=True,
            base_url="/",
            lab_config={"user_settings_dir": str(self.root)},
        )
        setup_handlers(app, SimpleNamespace(config=Config()))
        return app

    def request(self, path, body=None):
        kwargs = {"headers": {"Authorization": "token test-token"}}
        if body is not None:
            kwargs.update(method="POST", body=json.dumps(body))
        return self.http_client.fetch(
            self.get_url("/jupyterlab-launchpad/" + path), raise_error=False, **kwargs
        )

    async def assert_responsive(self, body, *, fail=False):
        started = threading.Event()
        release = threading.Event()
        finished = threading.Event()
        loop_thread = threading.get_ident()
        response_threads = []
        worker_threads = []
        finish = NebiActionHandler.finish

        def record_finish(handler, *args, **kwargs):
            response_threads.append(threading.get_ident())
            return finish(handler, *args, **kwargs)

        def delayed_operation(*args, **kwargs):
            worker_threads.append(threading.get_ident())
            started.set()
            # Bound the wait so a regressed event loop can still finish the test.
            release.wait(timeout=3)
            finished.set()
            return subprocess.CompletedProcess(
                args[0], int(fail), "", "controlled command failure"
            )

        async def wait_started():
            while not started.is_set():
                await asyncio.sleep(0.01)

        with patch.object(NebiActionHandler, "finish", record_finish), patch(
            "jupyterlab_launchpad.handlers.subprocess.run",
            side_effect=delayed_operation,
        ):
            operation = self.request("nebi/pull", body)
            try:
                await asyncio.wait_for(wait_started(), timeout=5)
                probe = await self.request("database/favorites")
                self.assertEqual(probe.code, 200)
                self.assertEqual(json.loads(probe.body), {})
                self.assertFalse(
                    finished.is_set(), "Unrelated request waited for the operation"
                )
                self.assertFalse(operation.done())
            finally:
                release.set()
                response = await operation

        self.assertEqual(response.code, 500 if fail else 200)
        if fail:
            self.assertEqual(
                json.loads(response.body)["message"], "controlled command failure"
            )
        else:
            self.assertEqual(json.loads(response.body), {"ok": True})
        self.assertTrue(worker_threads)
        self.assertTrue(all(thread != loop_thread for thread in worker_threads))
        self.assertEqual(response_threads, [loop_thread])

    @gen_test(timeout=10)
    async def test_pull_does_not_block_unrelated_requests(self):
        await self.assert_responsive({"workspace": "demo", "remoteVersion": "v2"})

    @gen_test
    async def test_removed_install_endpoint_returns_404(self):
        with patch("jupyterlab_launchpad.handlers._run_command") as run:
            for body in ({}, {"workspacePath": "/tmp/demo", "repair": True}):
                with self.subTest(body=body):
                    response = await self.request("nebi/install-dependencies", body)
                    self.assertEqual(response.code, 404)
            run.assert_not_called()

    @gen_test(timeout=10)
    async def test_command_failure_does_not_block_and_is_written_on_event_loop(self):
        await self.assert_responsive({"workspace": "demo"}, fail=True)

    @gen_test
    async def test_validation_errors_do_not_run_commands(self):
        cases = [
            ("pull", [1], "Invalid request body", 400),
            ("pull", {}, "Missing workspace", 400),
            ("pull", {"workspace": "--help"}, "Invalid Nebi workspace", 400),
            (
                "pull",
                {"workspace": "demo", "remoteVersion": "--help"},
                "Invalid Nebi remote version",
                400,
            ),
        ]
        with patch("jupyterlab_launchpad.handlers._run_command") as run:
            for action, body, message, status in cases:
                with self.subTest(action=action, body=body):
                    response = await self.request(f"nebi/{action}", body)
                    self.assertEqual(response.code, status)
                    self.assertIn(message, json.loads(response.body)["message"])
            run.assert_not_called()

    @gen_test
    async def test_command_errors_keep_their_responses(self):
        for error, message in (
            (FileNotFoundError(), "nebi was not found on PATH"),
            (subprocess.TimeoutExpired(["nebi"], 300), "nebi timed out"),
        ):
            with self.subTest(error=error), patch(
                "jupyterlab_launchpad.handlers.subprocess.run", side_effect=error
            ) as run:
                response = await self.request("nebi/pull", {"workspace": "demo"})
                self.assertEqual(response.code, 500)
                self.assertEqual(json.loads(response.body)["message"], message)
                self.assertEqual(run.call_args.kwargs["timeout"], 300)
