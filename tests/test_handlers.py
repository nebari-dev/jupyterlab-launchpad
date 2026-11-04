import json
from pathlib import Path
import shutil
import subprocess
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, call, patch

from tornado.web import HTTPError
from traitlets.config import Config

from jupyterlab_launchpad.handlers import NebiActionHandler, _resolve_workspace_dir


class NebiWorkspaceTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name).resolve()
        self.root = self.base / "home" / "jovyan"
        self.root.mkdir(parents=True)
        self.workspace = self.base / "var" / "lib" / "nebi" / "workspaces" / "demo"
        self.workspace.mkdir(parents=True)
        self.manifest = self.workspace / "pixi.toml"
        self.manifest.write_text('[workspace]\nname = "demo"\n')
        self.manager = Mock()
        self.manager.get_all_specs.return_value = {}
        self.json_command = patch("jupyterlab_launchpad.handlers._run_json_command", side_effect=self.nebi_json).start()
        self.addCleanup(patch.stopall)
        self.server = SimpleNamespace(
            root_dir=str(self.root), kernel_spec_manager=self.manager, config=Config()
        )

    def install(self, handler, body):
        return NebiActionHandler._install_dependencies(handler, {
            "repairStage": "prepare", "workspaceId": "workspace-id", **body,
        })

    def nebi_json(self, cmd, cwd=None):
        if cmd == ["nebi", "workspace", "list", "--json"]:
            return [{"id": "workspace-id", "path": str(self.workspace)}]
        if cmd[3] == "list":
            return [{"version_number": 1, "content_hash": ""}]
        lockfile = self.workspace / "pixi.lock"
        return {
            "manifest_content": self.manifest.read_text(),
            "lock_file_content": lockfile.read_text() if lockfile.exists() else "",
            "content_hash": "",
        }

    def discover(self, path):
        self.manager.get_all_specs.return_value = {
            "nebi-demo": {
                "spec": {"metadata": {"nebi_workspace_path": path}}
            }
        }

    def repair_calls(self, dependencies):
        return [call(["pixi", "add", "--frozen", "--no-install", "--manifest-path", str(self.manifest)]
                     + dependencies, cwd=self.workspace)]

    def test_file_browser_paths_still_work_without_nebi(self):
        workspace = self.root / "local"
        workspace.mkdir()
        for path in ("local", str(workspace)):
            with self.subTest(path=path):
                self.assertEqual(_resolve_workspace_dir(self.server, path), workspace)
        self.manager.get_all_specs.assert_not_called()

    def test_both_actions_accept_discovered_external_workspace(self):
        self.discover(str(self.workspace))
        self.server.config.NebiConfig.kernel_dependencies = ["custom-kernel"]
        for dependencies, operation in (([], "install"), (["ipykernel"], "add")):
            for environment in ("", "default"):
                with self.subTest(operation=operation, environment=environment):
                    handler = Mock(spec=NebiActionHandler)
                    NebiActionHandler.initialize(handler, "install-dependencies", self.server)
                    with patch(
                        "jupyterlab_launchpad.handlers._run_command",
                        return_value={"ok": True},
                    ) as run:
                        self.install(
                            handler,
                            {
                                "workspacePath": str(self.workspace),
                                "environment": environment,
                                "missingDependencies": dependencies,
                                "repair": bool(dependencies),
                            },
                        )
                    if dependencies:
                        self.assertEqual(run.call_args_list, self.repair_calls(dependencies))
                    else:
                        run.assert_called_once_with(
                            ["pixi", "install", "--locked", "--manifest-path", str(self.manifest)],
                            cwd=self.workspace,
                        )


    def test_named_environment_does_not_modify_default_environment(self):
        self.discover(str(self.workspace))
        for dependencies in ([], ["ipykernel"]):
            with self.subTest(dependencies=dependencies):
                handler = Mock(spec=NebiActionHandler)
                NebiActionHandler.initialize(handler, "install-dependencies", self.server)
                with patch("jupyterlab_launchpad.handlers._run_command") as run:
                    with self.assertRaisesRegex(HTTPError, "only supports the default"):
                        self.install(
                            handler,
                            {
                                "workspacePath": str(self.workspace),
                                "environment": "analysis",
                                "missingDependencies": dependencies,
                            },
                        )
                    run.assert_not_called()

    def test_missing_kernel_uses_server_configuration(self):
        self.discover(str(self.workspace))
        for configured in (None, ["custom-kernel", "sandbox-package"], []):
            for missing in ([], ["numpy"]):
                with self.subTest(configured=configured, missing=missing):
                    self.server.config = Config()
                    if configured is not None:
                        self.server.config.NebiConfig.kernel_dependencies = configured
                    handler = Mock(spec=NebiActionHandler)
                    NebiActionHandler.initialize(handler, "install-dependencies", self.server)
                    body = {
                        "workspacePath": str(self.workspace),
                        "repair": True,
                        "notReadyReason": "kernel-not-installed",
                        "missingDependencies": missing.copy(),
                    }
                    expected = missing + (
                        configured if configured is not None else ["ipykernel"]
                    )
                    with patch(
                        "jupyterlab_launchpad.handlers._run_command", return_value={"ok": True}
                    ) as run:
                        if not expected:
                            with self.assertRaisesRegex(HTTPError, "No automatic repair"):
                                self.install(handler, body)
                            run.assert_not_called()
                        else:
                            self.install(handler, body)
                            self.assertEqual(run.call_args_list, self.repair_calls(expected))
                    self.assertEqual(body["missingDependencies"], missing)
                    self.assertEqual(
                        handler.nebi_config.kernel_dependencies,
                        configured if configured is not None else ["ipykernel"],
                    )

    def test_user_kernel_packages_override_server_default(self):
        self.discover(str(self.workspace))
        for configured in (["ipykernel"], []):
            for override in ([], ["r-irkernel"]):
                with self.subTest(configured=configured, override=override):
                    self.server.config.NebiConfig.kernel_dependencies = configured
                    handler = Mock(spec=NebiActionHandler)
                    NebiActionHandler.initialize(handler, "install-dependencies", self.server)
                    with patch(
                        "jupyterlab_launchpad.handlers._run_command", return_value={"ok": True}
                    ) as run:
                        self.install(handler, {
                            "workspacePath": str(self.workspace),
                            "repair": True,
                            "notReadyReason": "kernel-not-installed",
                            "missingDependencies": ["numpy"],
                            "kernelDependencies": override,
                        })
                    self.assertEqual(
                        run.call_args_list, self.repair_calls(["numpy"] + (override or configured))
                    )
                    self.assertEqual(handler.nebi_config.kernel_dependencies, configured)

    def test_invalid_user_kernel_packages_do_not_run_install(self):
        self.discover(str(self.workspace))
        for override in (None, "ipykernel", {}, [1], [""], ["  "], ["--manifest-path"], [" -f"]):
            with self.subTest(override=override):
                handler = Mock(spec=NebiActionHandler)
                NebiActionHandler.initialize(handler, "install-dependencies", self.server)
                with patch("jupyterlab_launchpad.handlers._run_command") as run:
                    with self.assertRaisesRegex(HTTPError, "kernelDependencies must be"):
                        self.install(handler, {
                            "workspacePath": str(self.workspace),
                            "repair": True,
                            "notReadyReason": "kernel-not-installed",
                            "kernelDependencies": override,
                        })
                    run.assert_not_called()

    def test_kernel_override_does_not_affect_other_install_actions(self):
        self.discover(str(self.workspace))
        for repair, reason in ((True, "missing-dependencies"), (False, "kernel-not-installed")):
            with self.subTest(repair=repair, reason=reason):
                handler = Mock(spec=NebiActionHandler)
                NebiActionHandler.initialize(handler, "install-dependencies", self.server)
                with patch(
                    "jupyterlab_launchpad.handlers._run_command", return_value={"ok": True}
                ) as run:
                    self.install(handler, {
                        "workspacePath": str(self.workspace),
                        "repair": repair,
                        "notReadyReason": reason,
                        "missingDependencies": ["numpy"],
                        "kernelDependencies": ["r-irkernel"],
                    })
                self.assertEqual(run.call_args_list, self.repair_calls(["numpy"]))

    def test_failed_workspace_does_not_hide_valid_workspace(self):
        from jupyterlab_launchpad.handlers import _tracked_workspaces
        valid = {"id": "healthy", "path": str(self.workspace)}
        self.json_command.side_effect = None
        self.json_command.return_value = [valid, {"id": "failed", "status": "failed"},
                                          {"id": "pending", "path": None},
                                          {"id": "relative", "path": "relative"}]
        self.assertEqual(_tracked_workspaces(), [valid])

    def test_repair_plan_compares_contents_not_empty_server_hash(self):
        self.discover(str(self.workspace))
        handler = Mock(spec=NebiActionHandler)
        NebiActionHandler.initialize(handler, "install-dependencies", self.server)
        with patch("jupyterlab_launchpad.handlers._run_command") as command:
            result = self.install(handler, {
                "workspacePath": str(self.workspace), "missingDependencies": ["ipykernel"],
                "repairStage": "plan",
            })
        self.assertEqual(result, {"workspaceId": "workspace-id", "needsSave": False, "files": (self.manifest.read_bytes(), b"")})
        command.assert_not_called()
        self.assertFalse(any("create" in args[0] for args, _ in self.json_command.call_args_list))

    def test_changed_files_require_native_save_before_preparing(self):
        self.discover(str(self.workspace))
        handler = Mock(spec=NebiActionHandler)
        NebiActionHandler.initialize(handler, "install-dependencies", self.server)
        original_json = self.nebi_json
        def nebi_json(cmd, cwd=None):
            result = original_json(cmd, cwd)
            if "show" in cmd:
                result["manifest_content"] = "previous saved manifest"
            return result
        self.json_command.side_effect = nebi_json
        body = {"workspacePath": str(self.workspace), "missingDependencies": ["ipykernel"]}
        with patch("jupyterlab_launchpad.handlers._run_command") as command:
            self.assertTrue(self.install(handler, {**body, "repairStage": "plan"})["needsSave"])
            with self.assertRaisesRegex(HTTPError, "Workspace files changed"):
                self.install(handler, body)
        command.assert_not_called()

    def test_repair_rejects_untracked_and_pyproject_workspaces(self):
        self.discover(str(self.workspace))
        handler = Mock(spec=NebiActionHandler)
        NebiActionHandler.initialize(handler, "install-dependencies", self.server)
        body = {"workspacePath": str(self.workspace), "missingDependencies": ["ipykernel"]}
        with patch("jupyterlab_launchpad.handlers._run_command") as command:
            self.json_command.return_value = []
            self.json_command.side_effect = None
            with self.assertRaisesRegex(HTTPError, "not tracked"):
                self.install(handler, body)
            self.manifest.rename(self.workspace / "pyproject.toml")
            with self.assertRaisesRegex(HTTPError, "requires pixi.toml"):
                self.install(handler, body)
        command.assert_not_called()

    def test_failed_repair_does_not_overwrite_external_edits(self):
        self.discover(str(self.workspace))
        lockfile = self.workspace / "pixi.lock"
        for original_lock in (None, b"original lock"):
            for external_content in (None, b"saved by another process"):
                with self.subTest(original_lock=original_lock, external_content=external_content):
                    self.manifest.write_text("original manifest")
                    lockfile.unlink(missing_ok=True)
                    if original_lock is not None:
                        lockfile.write_bytes(original_lock)
                    handler = Mock(spec=NebiActionHandler)
                    NebiActionHandler.initialize(handler, "install-dependencies", self.server)
                    def run(cmd, cwd):
                        for path in (self.manifest, lockfile):
                            if external_content is None:
                                path.unlink(missing_ok=True)
                            else:
                                path.write_bytes(external_content)
                        raise HTTPError(500, log_message="repair failed")
                    with patch("jupyterlab_launchpad.handlers._run_command", side_effect=run):
                        with self.assertRaisesRegex(HTTPError, "repair failed"):
                            self.install(handler, {
                                "workspacePath": str(self.workspace),
                                "repair": True, "missingDependencies": ["ipykernel"],
                            })
                    for path in (self.manifest, lockfile):
                        self.assertEqual(path.read_bytes() if path.exists() else None, external_content)

    def test_prepared_repair_reports_changes_without_creating_cli_versions(self):
        self.discover(str(self.workspace))
        handler = Mock(spec=NebiActionHandler)
        NebiActionHandler.initialize(handler, "install-dependencies", self.server)
        body = {"workspacePath": str(self.workspace), "missingDependencies": ["ipykernel"]}
        for changed in (False, True):
            with self.subTest(changed=changed):
                def run(cmd, cwd):
                    if changed:
                        self.manifest.write_text("repaired specification")
                    return {"ok": True}
                with patch("jupyterlab_launchpad.handlers._run_command", side_effect=run) as command:
                    self.assertEqual(self.install(handler, body), {
                        "workspaceId": "workspace-id", "changed": changed, "files": (self.manifest.read_bytes(), b""),
                    })
                self.assertEqual(command.call_args_list, self.repair_calls(["ipykernel"]))

    def test_external_edit_during_history_query_is_not_overwritten(self):
        self.discover(str(self.workspace))
        handler = Mock(spec=NebiActionHandler)
        NebiActionHandler.initialize(handler, "install-dependencies", self.server)
        original_json = self.nebi_json
        def edit_during_history(cmd, cwd=None):
            result = original_json(cmd, cwd)
            if "show" in cmd:
                self.manifest.write_text("external edit")
            return result
        self.json_command.side_effect = edit_during_history
        with patch("jupyterlab_launchpad.handlers._run_command") as command:
            with self.assertRaisesRegex(HTTPError, "files changed during repair"):
                self.install(handler, {"workspacePath": str(self.workspace), "missingDependencies": ["ipykernel"]})
        command.assert_not_called()
        self.assertEqual(self.manifest.read_text(), "external edit")

    def test_unknown_repair_does_not_run_install(self):
        self.discover(str(self.workspace))
        handler = Mock(spec=NebiActionHandler)
        NebiActionHandler.initialize(handler, "install-dependencies", self.server)
        with patch("jupyterlab_launchpad.handlers._run_command") as run:
            with self.assertRaisesRegex(HTTPError, "No automatic repair"):
                NebiActionHandler._install_dependencies(
                    handler,
                    {
                        "workspacePath": str(self.workspace),
                        "repair": True,
                        "missingDependencies": [],
                    },
                )
            run.assert_not_called()

    def test_both_actions_reject_undiscovered_external_workspace(self):
        for dependencies in ([], ["ipykernel"]):
            with self.subTest(dependencies=dependencies):
                handler = Mock(spec=NebiActionHandler)
                NebiActionHandler.initialize(handler, "install-dependencies", self.server)
                with patch("jupyterlab_launchpad.handlers._run_command") as run:
                    with self.assertRaises(HTTPError) as error:
                        self.install(
                            handler,
                            {
                                "workspacePath": str(self.workspace),
                                "workspace": "demo",
                                "missingDependencies": dependencies,
                            },
                        )
                self.assertEqual(error.exception.status_code, 400)
                run.assert_not_called()

    def test_discovery_allows_only_the_exact_workspace(self):
        self.discover(str(self.workspace))
        child = self.workspace / "child"
        child.mkdir()
        sibling = self.workspace.with_name("demo-other")
        sibling.mkdir()
        for path in (child, sibling, self.workspace.parent):
            with self.subTest(path=path), self.assertRaises(HTTPError):
                _resolve_workspace_dir(self.server, str(path))

    def test_symlink_cannot_bypass_discovery(self):
        link = self.root / "linked"
        link.symlink_to(self.workspace, target_is_directory=True)
        with self.assertRaises(HTTPError):
            _resolve_workspace_dir(self.server, str(link))
        self.discover(str(self.workspace))
        self.assertEqual(_resolve_workspace_dir(self.server, str(link)), self.workspace)

    def test_traversal_cannot_bypass_discovery(self):
        path = self.root / ".." / ".." / "var" / "lib" / "nebi" / "workspaces" / "demo"
        with self.assertRaises(HTTPError):
            _resolve_workspace_dir(self.server, str(path))

    def test_missing_or_relative_discovery_path_does_not_authorize_external_path(self):
        for path in (None, "", 123, "../../var/lib/nebi/workspaces/demo"):
            with self.subTest(path=path):
                self.discover(path)
                with self.assertRaises(HTTPError):
                    _resolve_workspace_dir(self.server, str(self.workspace))

    def test_external_path_requires_a_kernel_spec_manager(self):
        with self.assertRaises(HTTPError):
            _resolve_workspace_dir(
                SimpleNamespace(root_dir=str(self.root)), str(self.workspace)
            )

    def test_discovered_workspace_must_still_exist(self):
        missing = self.workspace / "missing"
        self.discover(str(missing))
        with self.assertRaises(HTTPError) as error:
            _resolve_workspace_dir(self.server, str(missing))
        self.assertEqual(error.exception.log_message, "Workspace path does not exist")


@unittest.skipUnless(shutil.which("pixi"), "Pixi is required for locked-install integration tests")
class LockedInstallTests(unittest.TestCase):
    def test_repair_preparation_leaves_resolution_to_nebi(self):
        # No channel can provide this package. Manifest-only preparation must
        # still succeed without solving, installing, or changing the lockfile.
        with TemporaryDirectory() as temporary:
            workspace = Path(temporary).resolve()
            manifest = workspace / "pixi.toml"
            lockfile = workspace / "pixi.lock"
            manifest.write_text(
                '[workspace]\nname = "manifest-only-test"\nchannels = []\n'
                'platforms = ["linux-64", "linux-aarch64", "osx-arm64", "osx-64", "win-64"]\n'
            )
            subprocess.run(["pixi", "lock", "--manifest-path", str(manifest)],
                           check=True, capture_output=True, text=True)
            saved = {"manifest_content": manifest.read_text(), "lock_file_content": lockfile.read_text()}
            def nebi_json(cmd, cwd=None):
                if cmd == ["nebi", "workspace", "list", "--json"]:
                    return [{"id": "workspace", "path": str(workspace)}]
                if "show" in cmd:
                    return saved
                return [{"version_number": 1}]
            handler = Mock(spec=NebiActionHandler)
            NebiActionHandler.initialize(handler, "install-dependencies",
                SimpleNamespace(root_dir=str(workspace), config=Config()))
            with patch("jupyterlab_launchpad.handlers._run_json_command", side_effect=nebi_json):
                result = NebiActionHandler._install_dependencies(handler, {
                    "workspacePath": str(workspace), "repairStage": "prepare", "workspaceId": "workspace",
                    "repair": True, "missingDependencies": ["nonexistent-launchpad-test-package"],
                })
            self.assertTrue(result["changed"])
            self.assertIn('nonexistent-launchpad-test-package = "*"', manifest.read_text())
            self.assertEqual(lockfile.read_text(), saved["lock_file_content"])
            self.assertFalse((workspace / ".pixi" / "envs" / "default").exists())

    def test_install_preserves_specification(self):
        # Use a real solver and installer, with no downloads or package dependencies.
        for state in ("current", "missing", "stale"):
            with self.subTest(state=state), TemporaryDirectory() as temporary:
                workspace = Path(temporary).resolve()
                manifest = workspace / "pixi.toml"
                lockfile = workspace / "pixi.lock"
                manifest.write_text(
                    '[workspace]\nname = "locked-install-test"\nchannels = []\n'
                    'platforms = ["linux-64", "linux-aarch64", "osx-arm64", "osx-64", "win-64"]\n'
                )
                if state != "missing":
                    subprocess.run(
                        ["pixi", "lock", "--manifest-path", str(manifest)],
                        check=True, capture_output=True, text=True,
                    )
                if state == "stale":
                    with manifest.open("a") as stream:
                        stream.write('\n[dependencies]\nnonexistent-launchpad-test-package = "*"\n')
                before_manifest = manifest.read_bytes()
                before_lock = lockfile.read_bytes() if lockfile.exists() else None
                handler = Mock(spec=NebiActionHandler)
                server = SimpleNamespace(root_dir=str(workspace), config=Config())
                NebiActionHandler.initialize(handler, "install-dependencies", server)
                body = {"workspacePath": str(workspace)}
                if state == "current":
                    self.assertEqual(NebiActionHandler._install_dependencies(handler, body), {"ok": True})
                    self.assertTrue((workspace / ".pixi" / "envs" / "default").is_dir())
                else:
                    with self.assertRaisesRegex(HTTPError, "Open this workspace in Nebi"):
                        NebiActionHandler._install_dependencies(handler, body)
                    handler.finish.assert_not_called()
                    self.assertFalse((workspace / ".pixi" / "envs" / "default").exists())
                self.assertEqual(manifest.read_bytes(), before_manifest)
                self.assertEqual(
                    lockfile.read_bytes() if lockfile.exists() else None, before_lock
                )


if __name__ == "__main__":
    unittest.main()
