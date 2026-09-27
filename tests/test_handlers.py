import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from tornado.web import HTTPError

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
        self.server = SimpleNamespace(
            root_dir=str(self.root), kernel_spec_manager=self.manager
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

    def test_both_actions_accept_discovered_external_workspace(self):
        self.discover(str(self.workspace))
        for dependencies, operation in (([], "install"), (["ipykernel"], "add")):
            with self.subTest(operation=operation):
                handler = Mock(spec=NebiActionHandler)
                handler.server_app = self.server
                with patch(
                    "jupyterlab_launchpad.handlers._run_command",
                    return_value={"ok": True},
                ) as run:
                    NebiActionHandler._install_dependencies(
                        handler,
                        {
                            "workspacePath": str(self.workspace),
                            "environment": "default",
                            "missingDependencies": dependencies,
                        },
                    )
                run.assert_called_once_with(
                    ["pixi", operation, "--manifest-path", str(self.manifest)]
                    + dependencies,
                    cwd=self.workspace,
                )
                self.assertEqual(
                    json.loads(handler.finish.call_args.args[0]), {"ok": True}
                )

    def test_both_actions_reject_undiscovered_external_workspace(self):
        for dependencies in ([], ["ipykernel"]):
            with self.subTest(dependencies=dependencies):
                handler = Mock(spec=NebiActionHandler)
                handler.server_app = self.server
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
        self.assertEqual(error.exception.reason, "Workspace path does not exist")


if __name__ == "__main__":
    unittest.main()
