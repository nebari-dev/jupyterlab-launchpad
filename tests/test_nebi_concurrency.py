import asyncio
import json
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import threading
from types import SimpleNamespace
from unittest.mock import patch

from jupyter_client.kernelspec import KernelSpecManager
from jupyter_server.auth import AllowAllAuthorizer
from jupyter_server.auth.identity import IdentityProvider
from jupyter_server.services.kernelspecs.handlers import MainKernelSpecHandler
from tornado.testing import AsyncHTTPTestCase, gen_test
from tornado.web import Application
from traitlets.config import Config

from jupyterlab_launchpad.handlers import DatabaseHandler, NebiActionHandler


class NebiConcurrencyTests(AsyncHTTPTestCase):
    def get_app(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name).resolve()
        self.root = self.base / "root"
        self.root.mkdir()
        self.workspace = self.base / "external-workspace"
        self.workspace.mkdir()
        (self.workspace / "pixi.toml").write_text('[workspace]\nname = "demo"\n')
        self.specs = {
            "nebi-demo": {
                "resource_dir": str(self.workspace),
                "spec": {
                    "argv": [],
                    "display_name": "demo",
                    "language": "python",
                    "metadata": {"nebi_workspace_path": str(self.workspace)},
                },
            }
        }
        self.manager = KernelSpecManager(kernel_dirs=[])
        self.discovery_patch = patch.object(KernelSpecManager, "get_all_specs")
        self.discovery_patch.start()
        self.addCleanup(self.discovery_patch.stop)
        self.manager.get_all_specs.return_value = self.specs
        self.server = SimpleNamespace(
            root_dir=str(self.root), kernel_spec_manager=self.manager, config=Config()
        )
        return Application(
            [
                (
                    f"/{action}",
                    NebiActionHandler,
                    {"action": action, "server_app": self.server},
                )
                for action in ("pull", "install-dependencies", "unknown")
            ]
            + [
                (
                    "/probe",
                    DatabaseHandler,
                    {"name": "favorites", "settings_dir": str(self.root)},
                ),
                ("/api/kernelspecs", MainKernelSpecHandler),
            ],
            identity_provider=IdentityProvider(token="test-token"),
            authorizer=AllowAllAuthorizer(),
            kernel_spec_manager=self.manager,
            kernel_manager=SimpleNamespace(default_kernel_name="nebi-demo"),
            cookie_secret="test-secret",
            allow_remote_access=True,
            base_url="/",
        )

    def request(self, path, body=None):
        kwargs = {"headers": {"Authorization": "token test-token"}}
        if body is not None:
            kwargs.update(method="POST", body=json.dumps(body))
        return self.http_client.fetch(self.get_url(path), raise_error=False, **kwargs)

    async def assert_responsive(self, action, body, *, lookup=False, fail=False):
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
            if lookup:
                return self.specs
            return subprocess.CompletedProcess(
                args[0], int(fail), "", "controlled command failure"
            )

        async def wait_started():
            while not started.is_set():
                await asyncio.sleep(0.01)

        with patch.object(NebiActionHandler, "finish", record_finish), patch(
            "jupyterlab_launchpad.handlers.subprocess.run",
            side_effect=None if lookup else delayed_operation,
            return_value=subprocess.CompletedProcess([], 0, "", ""),
        ):
            if lookup:
                self.manager.get_all_specs.side_effect = delayed_operation
            operation = self.request(f"/{action}", body)
            try:
                await asyncio.wait_for(wait_started(), timeout=5)
                probe = await self.request("/probe")
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
        await self.assert_responsive(
            "pull", {"workspace": "demo", "remoteVersion": "v2"}
        )

    @gen_test(timeout=10)
    async def test_install_does_not_block_unrelated_requests(self):
        await self.assert_responsive(
            "install-dependencies", {"workspacePath": str(self.workspace)}
        )

    @gen_test(timeout=10)
    async def test_workspace_discovery_does_not_block_unrelated_requests(self):
        await self.assert_responsive(
            "install-dependencies", {"workspacePath": str(self.workspace)}, lookup=True
        )

    @gen_test(timeout=10)
    async def test_command_failure_does_not_block_and_is_written_on_event_loop(self):
        await self.assert_responsive("pull", {"workspace": "demo"}, fail=True)

    @gen_test(timeout=10)
    async def test_actions_and_native_discovery_do_not_share_mutable_state(self):
        self.discovery_patch.stop()
        self.manager.kernel_dirs = [str(self.workspace)]
        self.manager.allowed_kernelspecs = {"nebi-demo"}
        started, release = threading.Event(), threading.Event()
        active = set()

        def discover(manager):
            self.assertEqual(manager.kernel_dirs, self.manager.kernel_dirs)
            self.assertEqual(manager.allowed_kernelspecs, {"nebi-demo"})
            if manager in active:
                raise RuntimeError("Concurrent access to discovery registry")
            active.add(manager)
            try:
                if not started.is_set():
                    started.set()
                    release.wait(timeout=3)
                return self.specs
            finally:
                active.remove(manager)

        with patch.object(
            KernelSpecManager, "get_all_specs", autospec=True, side_effect=discover
        ), patch(
            "jupyterlab_launchpad.handlers._run_command", return_value={"ok": True}
        ):
            body = {"workspacePath": str(self.workspace)}
            first = self.request("/install-dependencies", body)
            try:
                while not started.is_set():
                    await asyncio.sleep(0.01)
                native = await self.request("/api/kernelspecs")
                self.assertEqual(native.code, 200)
                self.assertIn("nebi-demo", json.loads(native.body)["kernelspecs"])
                second = await self.request("/install-dependencies", body)
                self.assertEqual(second.code, 200)
                self.assertEqual((await self.request("/probe")).code, 200)
                self.assertFalse(first.done())
            finally:
                release.set()
                response = await first
            self.assertEqual(response.code, 200)

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
            ("install-dependencies", {}, "Missing workspace path", 400),
            (
                "install-dependencies",
                {"workspacePath": str(self.base)},
                "Workspace path is outside",
                400,
            ),
            (
                "install-dependencies",
                {"workspacePath": str(self.workspace), "environment": "analysis"},
                "only supports the default",
                400,
            ),
            (
                "install-dependencies",
                {"workspacePath": str(self.workspace), "repair": True},
                "package API",
                400,
            ),
            ("unknown", {}, "Unknown Nebi action", 404),
        ]
        with patch("jupyterlab_launchpad.handlers._run_command") as run:
            for action, body, message, status in cases:
                with self.subTest(action=action, body=body):
                    response = await self.request(f"/{action}", body)
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
                response = await self.request("/pull", {"workspace": "demo"})
                self.assertEqual(response.code, 500)
                self.assertEqual(json.loads(response.body)["message"], message)
                self.assertEqual(run.call_args.kwargs["timeout"], 300)
