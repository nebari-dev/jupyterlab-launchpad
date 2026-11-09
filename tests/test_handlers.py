import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from jupyter_client.kernelspec import KernelSpecManager
from tornado.web import HTTPError
from traitlets.config import Config

from jupyterlab_launchpad.handlers import (
    NebiActionHandler, NebiCapabilitiesHandler, _resolve_workspace_dir
)


class NebiCapabilitiesTests(unittest.TestCase):
    def test_kernel_defaults_are_exposed_including_disabled_installation(self):
        for packages in (None, [], ["r-irkernel"]):
            with self.subTest(packages=packages):
                config = Config()
                if packages is not None:
                    config.NebiConfig.kernel_dependencies = packages
                handler = Mock(spec=NebiCapabilitiesHandler)
                NebiCapabilitiesHandler.initialize(handler, SimpleNamespace(config=config))
                with patch("jupyterlab_launchpad.handlers.shutil.which", return_value="/bin/tool"):
                    NebiCapabilitiesHandler.get.__wrapped__(handler)
                response = json.loads(handler.finish.call_args.args[0])
                self.assertEqual(response["kernelDependencies"], ["ipykernel"] if packages is None else packages)


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
        self.manager = KernelSpecManager(kernel_dirs=[])
        discovery = patch.object(KernelSpecManager, "get_all_specs")
        discovery.start()
        self.addCleanup(discovery.stop)
        self.manager.get_all_specs.return_value = {}
        self.server = SimpleNamespace(
            root_dir=str(self.root), kernel_spec_manager=self.manager, config=Config()
        )

    def discover(self, path):
        self.manager.get_all_specs.return_value = {
            "nebi-demo": {
                "spec": {"metadata": {"nebi_workspace_path": path}}
            }
        }

    def test_file_browser_paths_still_work_without_nebi(self):
        workspace = self.root / "local"
        workspace.mkdir()
        for path in ("local", str(workspace)):
            with self.subTest(path=path):
                self.assertEqual(_resolve_workspace_dir(self.server, path), workspace)
        self.manager.get_all_specs.assert_not_called()

    def test_install_accepts_discovered_external_workspace(self):
        self.discover(str(self.workspace))
        handler = Mock(spec=NebiActionHandler)
        NebiActionHandler.initialize(handler, "install-dependencies", self.server)
        with patch("jupyterlab_launchpad.handlers._run_command", return_value={"ok": True}) as run:
            result = NebiActionHandler._install_dependencies(handler, {"workspacePath": str(self.workspace)})
        run.assert_called_once_with(
            ["pixi", "install", "--manifest-path", str(self.manifest)], cwd=self.workspace)
        self.assertEqual(result, {"ok": True})
        handler.finish.assert_not_called()

    def test_legacy_repair_cannot_modify_dependencies_without_a_version(self):
        self.discover(str(self.workspace))
        handler = Mock(spec=NebiActionHandler)
        NebiActionHandler.initialize(handler, "install-dependencies", self.server)
        for extra in ({"repair": True}, {"missingDependencies": ["ipykernel"]}):
            with self.subTest(extra=extra), patch("jupyterlab_launchpad.handlers._run_command") as run:
                with self.assertRaisesRegex(HTTPError, "package API"):
                    NebiActionHandler._install_dependencies(
                        handler, {"workspacePath": str(self.workspace), **extra})
                run.assert_not_called()

    def test_both_actions_reject_undiscovered_external_workspace(self):
        for dependencies in ([], ["ipykernel"]):
            with self.subTest(dependencies=dependencies):
                handler = Mock(spec=NebiActionHandler)
                NebiActionHandler.initialize(handler, "install-dependencies", self.server)
                with patch("jupyterlab_launchpad.handlers._run_command") as run:
                    with self.assertRaises(HTTPError) as error:
                        NebiActionHandler._install_dependencies(
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


if __name__ == "__main__":
    unittest.main()
