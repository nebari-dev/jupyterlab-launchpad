import json
from pathlib import Path
import re
import shutil
import subprocess
from typing import Any, Dict, List, Optional

from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join
import tornado


_NEBI_WORKSPACE_RE = re.compile(r"^(?!-)[A-Za-z0-9._/@:+-]+$")
_NEBI_VERSION_RE = re.compile(r"^(?!-)[A-Za-z0-9._+-]+$")


class DatabaseHandler(APIHandler):
    # Polling this handler every 10s resets jupyter_server's api_last_activity,
    # preventing shutdown_no_activity_timeout from ever firing.
    _track_activity = False

    def initialize(self, name: str, settings_dir: str):
        self.path = Path(settings_dir) / "jupyterlab-launchpad" / f"{name}.json"
        old_path = Path(settings_dir) / "jupyterlab-new-launcher" / f"{name}.json"
        if not self.path.exists() and old_path.exists():
            # migrate database from prior to rename
            self.path.parent.mkdir(exist_ok=True, parents=True)
            shutil.copy(old_path, self.path)
            old_path.unlink()

    # The following decorator should be present on all verb methods (head, get, post,
    # patch, put, delete, options) to ensure only authorized user can request the
    # Jupyter server
    @tornado.web.authenticated
    def get(self):
        if not self.path.exists():
            return self.finish("{}")
        # read-through to raise any syntax errors on server-side
        data = json.loads(self.path.read_text(encoding="utf-8"))
        self.finish(json.dumps(data))

    @tornado.web.authenticated
    def post(self):
        # parse to ensure we do not write malformed data
        data = self.get_json_body()
        json_code = json.dumps(data)
        # write
        self.path.parent.mkdir(exist_ok=True, parents=True)
        self.path.write_text(json_code, encoding="utf-8")
        # tell client that all is ok
        self.set_status(204)


class KernelDiscoveryRefreshHandler(APIHandler):
    def initialize(self, server_app):
        self.server_app = server_app

    @tornado.web.authenticated
    def post(self):
        manager = getattr(self.server_app, "kernel_spec_manager", None)
        invalidate = getattr(manager, "invalidate_discovery_cache", None)
        invalidated = False

        if callable(invalidate):
            invalidate()
            invalidated = True

        self.finish(json.dumps({"invalidated": invalidated}))


class NebiActionHandler(APIHandler):
    def initialize(self, action: str, server_app):
        self.action = action
        self.server_app = server_app

    @tornado.web.authenticated
    def post(self):
        body = self.get_json_body() or {}
        if not isinstance(body, dict):
            raise tornado.web.HTTPError(400, reason="Invalid request body")

        if self.action == "pull":
            self._pull_workspace(body)
        elif self.action == "install-dependencies":
            self._install_dependencies(body)
        elif self.action == "config-path":
            self._config_path(body)
        else:
            raise tornado.web.HTTPError(404, reason="Unknown Nebi action")

    def _pull_workspace(self, body: Dict[str, Any]):
        workspace = _string_field(body, "workspace")
        if not workspace:
            raise tornado.web.HTTPError(400, reason="Missing workspace")
        _validate_nebi_field(workspace, _NEBI_WORKSPACE_RE, "workspace")

        remote_version = _string_field(body, "remoteVersion")
        if remote_version:
            _validate_nebi_field(
                remote_version, _NEBI_VERSION_RE, "remote version"
            )
        workspace_ref = f"{workspace}:{remote_version}" if remote_version else workspace
        result = _run_command(["nebi", "pull", workspace_ref, "--force"])
        self.finish(json.dumps(result))

    def _install_dependencies(self, body: Dict[str, Any]):
        workspace_path = _string_field(body, "workspacePath")
        if not workspace_path:
            raise tornado.web.HTTPError(400, reason="Missing workspace path")

        workspace_dir = _resolve_workspace_dir(self.server_app, workspace_path)

        manifest = _find_manifest(workspace_dir)
        if not manifest.exists():
            raise tornado.web.HTTPError(400, reason="Workspace manifest does not exist")

        dependencies = [
            item
            for item in body.get("missingDependencies", [])
            if isinstance(item, str) and item
        ]

        if dependencies:
            cmd = ["pixi", "add", "--manifest-path", str(manifest)]
            environment = _string_field(body, "environment")
            if environment and environment != "default":
                cmd.extend(["-e", environment])
            cmd.extend(dependencies)
        else:
            cmd = ["pixi", "install", "--manifest-path", str(manifest)]

        result = _run_command(cmd, cwd=workspace_dir)
        self.finish(json.dumps(result))

    def _config_path(self, body: Dict[str, Any]):
        workspace_path = _string_field(body, "workspacePath")
        if not workspace_path:
            raise tornado.web.HTTPError(400, reason="Missing workspace path")

        workspace_dir = _resolve_workspace_dir(self.server_app, workspace_path)
        manifest = _find_manifest(workspace_dir)
        if not manifest.exists():
            raise tornado.web.HTTPError(400, reason="Workspace manifest does not exist")

        self.finish(
            json.dumps(
                {
                    "path": _contents_path(self.server_app, manifest),
                }
            )
        )


class NebiCapabilitiesHandler(APIHandler):
    @tornado.web.authenticated
    def get(self):
        self.finish(
            json.dumps(
                {
                    "nebi": shutil.which("nebi") is not None,
                    "pixi": shutil.which("pixi") is not None,
                }
            )
        )


def _string_field(body: Dict[str, Any], key: str) -> str:
    value = body.get(key)
    return value if isinstance(value, str) else ""


def _find_manifest(workspace_dir: Path) -> Path:
    for name in ("pixi.toml", "pyproject.toml"):
        path = workspace_dir / name
        if path.exists():
            return path
    return workspace_dir / "pixi.toml"


def _validate_nebi_field(
    value: str, pattern: re.Pattern[str], field: str
) -> None:
    if not pattern.fullmatch(value):
        raise tornado.web.HTTPError(400, reason=f"Invalid Nebi {field}")


def _server_root(server_app) -> Path:
    root = getattr(server_app, "root_dir", None) or getattr(
        getattr(server_app, "contents_manager", None), "root_dir", ""
    )
    return Path(root).resolve()


def _resolve_workspace_dir(server_app, workspace_path: str) -> Path:
    root_path = _server_root(server_app)
    workspace_dir = Path(workspace_path)
    if not workspace_dir.is_absolute():
        workspace_dir = root_path / workspace_dir
    resolved_dir = workspace_dir.resolve()

    try:
        resolved_dir.relative_to(root_path)
    except ValueError:
        raise tornado.web.HTTPError(
            400,
            reason="Workspace path is outside the Jupyter file browser root",
        )

    if not resolved_dir.is_dir():
        raise tornado.web.HTTPError(400, reason="Workspace path does not exist")

    return resolved_dir


def _contents_path(server_app, path: Path) -> str:
    root_path = _server_root(server_app)
    resolved_path = path.resolve()

    try:
        relative_path = resolved_path.relative_to(root_path)
    except ValueError:
        raise tornado.web.HTTPError(
            400,
            reason="Workspace config is outside the Jupyter file browser root",
        )

    return relative_path.as_posix()


def _run_command(cmd: List[str], cwd: Optional[Path] = None) -> Dict[str, Any]:
    try:
        result = subprocess.run(
            cmd,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=300,
        )
    except FileNotFoundError:
        raise tornado.web.HTTPError(500, reason=f"{cmd[0]} was not found on PATH")
    except subprocess.TimeoutExpired:
        raise tornado.web.HTTPError(500, reason=f"{cmd[0]} timed out")

    if result.returncode != 0:
        message = (
            result.stderr.strip()
            or result.stdout.strip()
            or f"{cmd[0]} failed"
        )
        raise tornado.web.HTTPError(500, reason=message)

    return {"ok": True}


def setup_handlers(web_app, server_app):
    host_pattern = ".*$"

    base_url = web_app.settings["base_url"]
    api_url = url_path_join(base_url, "jupyterlab-launchpad")
    db_url = url_path_join(api_url, "database")
    kernels_url = url_path_join(api_url, "kernels")
    nebi_url = url_path_join(api_url, "nebi")
    kwargs = {"settings_dir": web_app.settings["lab_config"]["user_settings_dir"]}
    handlers = [
        (
            url_path_join(db_url, "last-used"),
            DatabaseHandler,
            {"name": "last-used", **kwargs},
        ),
        (
            url_path_join(db_url, "favorites"),
            DatabaseHandler,
            {"name": "favorites", **kwargs},
        ),
        (
            url_path_join(kernels_url, "refresh"),
            KernelDiscoveryRefreshHandler,
            {"server_app": server_app},
        ),
        (url_path_join(nebi_url, "capabilities"), NebiCapabilitiesHandler),
        (
            url_path_join(nebi_url, "pull"),
            NebiActionHandler,
            {"action": "pull", "server_app": server_app},
        ),
        (
            url_path_join(nebi_url, "install-dependencies"),
            NebiActionHandler,
            {"action": "install-dependencies", "server_app": server_app},
        ),
        (
            url_path_join(nebi_url, "config-path"),
            NebiActionHandler,
            {"action": "config-path", "server_app": server_app},
        ),
    ]
    web_app.add_handlers(host_pattern, handlers)
