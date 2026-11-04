import asyncio
import json
from pathlib import Path
import re
import shutil
import subprocess
import time
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4
from typing import Any, Dict, List, Optional

from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join
import tornado
from tornado.httpclient import AsyncHTTPClient, HTTPRequest
from tornado.ioloop import IOLoop

from .nebi_repair import NebiRepair

from .config import NebiConfig


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
        self.nebi_config = NebiConfig(config=server_app.config)

    @tornado.web.authenticated
    async def post(self):
        body = self.get_json_body() or {}
        if not isinstance(body, dict):
            raise tornado.web.HTTPError(400, log_message="Invalid request body")

        if self.action == "repair":
            await self._start_repair(body)
            return
        if "repairStage" in body or body.get("repair") or body.get("missingDependencies"):
            raise tornado.web.HTTPError(400, log_message="Use the repair operation instead of individual repair stages")

        if self.action == "pull":
            # Resolve an existing target so pull cannot overwrite a workspace
            # owned by a repair.
            tracked = await IOLoop.current().run_in_executor(None, _tracked_workspaces)
            target = next((item["path"] for item in tracked
                           if _string_field(body, "workspace") in (item.get("name"), item["id"])), None)
            key = str(Path(target).resolve()) if target else "pull:" + _string_field(body, "workspace")
            lock = _workspace_lock(self.settings, key)
            async with lock:
                result = await IOLoop.current().run_in_executor(None, self._pull_workspace, body)
        elif self.action == "install-dependencies":
            workspace_dir = await IOLoop.current().run_in_executor(
                None, _resolve_workspace_dir, self.server_app, _string_field(body, "workspacePath"))
            async with _workspace_lock(self.settings, str(workspace_dir)):
                result = await IOLoop.current().run_in_executor(None, self._install_dependencies, body, workspace_dir)
        else:
            raise tornado.web.HTTPError(404, log_message="Unknown Nebi action")
        self.finish(json.dumps(result))

    async def _start_repair(self, body):
        if body.get("repair") is not True and not body.get("missingDependencies"):
            raise tornado.web.HTTPError(400, log_message="Missing repair request")
        workspace = await IOLoop.current().run_in_executor(
            None, _resolve_workspace_dir, self.server_app, _string_field(body, "workspacePath"))
        owner = self.current_user.username
        headers = {name: self.request.headers[name] for name in ("Authorization", "Cookie", "X-XSRFToken")
                   if name in self.request.headers}
        headers["Content-Type"] = "application/json"
        # Jupyter's login cookie name includes the external host/port. Preserve
        # that name when the local connection uses a different published port.
        headers["Host"] = self.request.host
        operations = self.settings.setdefault("launchpad_nebi_repairs", {})
        # Completed results are retained for reconnecting clients for one hour.
        for key, operation in list(operations.items()):
            if operation["status"] in ("completed", "failed") and time.monotonic() - operation["updated"] > 3600:
                del operations[key]
        for key, operation in operations.items():
            if operation["workspace"] == str(workspace) and operation["status"] in ("running", "needs_attention"):
                if operation["owner"] != owner:
                    raise tornado.web.HTTPError(409, log_message="A repair is already running for this workspace")
                # Replace the full snapshot: absent headers must not retain an
                # expired token or cookie when the owner rejoins after login.
                operation["headers"] = headers
                if operation["status"] == "needs_attention":
                    operation["status"] = "running"
                    operation["error"] = None
                    operation["retry"].set()
                self.set_status(202)
                self.finish(json.dumps({"id": key, "status": "running"}))
                return
        identifier = uuid4().hex
        operation = {"owner": owner, "workspace": str(workspace), "status": "running", "updated": time.monotonic(), "retry": asyncio.Event(), "headers": headers}
        operations[identifier] = operation
        # Derive the loopback target from the server, never from request metadata.
        parts = urlsplit(self.server_app.local_url)
        api_url = urlunsplit((parts.scheme, parts.netloc,
                             url_path_join(self.settings["base_url"], "nebi/api/v1/"), "", ""))
        async def request(path, method="GET"):
            response = await AsyncHTTPClient().fetch(HTTPRequest(
                api_url + path, method=method, headers=operation["headers"],
                body="{}" if method == "POST" else None,
                request_timeout=60, follow_redirects=False,
            ), raise_error=False)
            try:
                data = json.loads(response.body)
            except ValueError as error:
                if response.code < 300:
                    raise tornado.web.HTTPError(502, log_message="Nebi returned an invalid response") from error
                # A proxy may reject the request with an HTML or empty body.
                data = None
            if response.code >= 300:
                message = (data.get("error") or data.get("message")) if isinstance(data, dict) else None
                raise tornado.web.HTTPError(response.code, log_message=message or f"Nebi request failed (HTTP {response.code})")
            return data

        def prepare(stage):
            return self._install_dependencies({**body, **stage}, workspace)

        async def wait_for_retry(message):
            operation["retry"].clear()
            operation["status"] = "needs_attention"
            operation["error"] = message
            await operation["retry"].wait()

        async def run():
            lock = _workspace_lock(self.settings, str(workspace))
            try:
                async with lock:
                    await NebiRepair(workspace, prepare, request, _run_command, _run_json_command, wait_for_retry).run()
                operation["status"] = "completed"
            except Exception as error:
                operation["status"] = "failed"
                operation["error"] = error.log_message if isinstance(error, tornado.web.HTTPError) else "Repair failed. Review the workspace in Nebi."
                self.log.warning("Nebi repair failed: %s", operation["error"])
            finally:
                operation["updated"] = time.monotonic()
                manager = getattr(self.server_app, "kernel_spec_manager", None)
                invalidate = getattr(manager, "invalidate_discovery_cache", None)
                if callable(invalidate):
                    invalidate()

        # Retain the task independently of the initiating HTTP connection.
        operation["task"] = asyncio.create_task(run())
        self.set_status(202)
        self.finish(json.dumps({"id": identifier, "status": "running"}))

    def _pull_workspace(self, body: Dict[str, Any]):
        workspace = _string_field(body, "workspace")
        if not workspace:
            raise tornado.web.HTTPError(400, log_message="Missing workspace")
        _validate_nebi_field(workspace, _NEBI_WORKSPACE_RE, "workspace")

        remote_version = _string_field(body, "remoteVersion")
        if remote_version:
            _validate_nebi_field(
                remote_version, _NEBI_VERSION_RE, "remote version"
            )
        workspace_ref = f"{workspace}:{remote_version}" if remote_version else workspace
        result = _run_command(["nebi", "pull", workspace_ref, "--force"])
        return result

    def _install_dependencies(self, body: Dict[str, Any], workspace_dir: Optional[Path] = None):
        workspace_path = _string_field(body, "workspacePath")
        if not workspace_path:
            raise tornado.web.HTTPError(400, log_message="Missing workspace path")

        if workspace_dir is None:
            workspace_dir = _resolve_workspace_dir(self.server_app, workspace_path)

        manifest = _find_manifest(workspace_dir)
        if not manifest.exists():
            raise tornado.web.HTTPError(400, log_message="Workspace manifest does not exist")

        # Nebi currently runs only the default environment in each workspace.
        if _string_field(body, "environment") not in ("", "default"):
            raise tornado.web.HTTPError(
                400,
                log_message="Nebi only supports the default environment. "
                "Open this workspace in Nebi.",
            )

        dependencies = body.get("missingDependencies", [])
        if not isinstance(dependencies, list) or any(
            not isinstance(item, str) or not item.strip() or item.strip().startswith("-")
            for item in dependencies
        ):
            raise tornado.web.HTTPError(400, log_message="Invalid missing dependency specifications")
        dependencies = list(dependencies)
        if (
            body.get("repair") is True
            and _string_field(body, "notReadyReason") == "kernel-not-installed"
        ):
            kernel_dependencies = body.get("kernelDependencies", [])
            if not isinstance(kernel_dependencies, list) or any(
                not isinstance(package, str)
                or not package.strip()
                or package.strip().startswith("-")
                for package in kernel_dependencies
            ):
                raise tornado.web.HTTPError(
                    400, log_message="kernelDependencies must be a list of non-empty package specifications."
                )
            dependencies += kernel_dependencies or self.nebi_config.kernel_dependencies

        if body.get("repair") is True and not dependencies:
            raise tornado.web.HTTPError(
                400, log_message="No automatic repair is available. Open this environment in Nebi."
            )

        if dependencies:
            result = _prepare_dependency_repair(workspace_dir, manifest, dependencies, body)
        else:
            # Installation must not resolve a different, unversioned specification.
            try:
                result = _run_command(
                    ["pixi", "install", "--locked", "--manifest-path", str(manifest)],
                    cwd=workspace_dir,
                )
            except tornado.web.HTTPError as error:
                raise tornado.web.HTTPError(
                    error.status_code,
                    log_message=f"{error.log_message}\nInstall requires an up-to-date lockfile. "
                    "Open this workspace in Nebi to resolve configuration changes as a new version.",
                ) from error

        return result

class NebiRepairStatusHandler(APIHandler):
    @tornado.web.authenticated
    def get(self, identifier):
        operation = self.settings.get("launchpad_nebi_repairs", {}).get(identifier)
        if operation is None or operation["owner"] != self.current_user.username:
            raise tornado.web.HTTPError(404, log_message="Repair operation not found")
        self.finish(json.dumps({"id": identifier, "status": operation["status"],
                                "error": operation.get("error")}))


class NebiCapabilitiesHandler(APIHandler):
    @tornado.web.authenticated
    async def get(self):
        nebi = shutil.which("nebi") is not None
        repair_workspaces = []
        if nebi:
            try:
                workspaces = await IOLoop.current().run_in_executor(None, _tracked_workspaces)
                repair_workspaces = [
                    str(Path(workspace["path"]).resolve())
                    for workspace in workspaces
                    if (Path(workspace["path"]) / "pixi.toml").is_file()
                ]
            except tornado.web.HTTPError:
                # An older CLI may exist without the required workspace APIs.
                pass
        self.finish(json.dumps({
            "nebi": nebi,
            "pixi": shutil.which("pixi") is not None,
            "repairWorkspaces": repair_workspaces,
        }))


def _string_field(body: Dict[str, Any], key: str) -> str:
    value = body.get(key)
    return value if isinstance(value, str) else ""


def _find_manifest(workspace_dir: Path) -> Path:
    for name in ("pixi.toml", "pyproject.toml"):
        path = workspace_dir / name
        if path.exists():
            return path
    return workspace_dir / "pixi.toml"


def _tracked_workspaces() -> List[Dict[str, Any]]:
    workspaces = _run_json_command(["nebi", "workspace", "list", "--json"])
    if not isinstance(workspaces, list):
        raise tornado.web.HTTPError(502, log_message="Invalid Nebi workspace list")
    # Failed/creating managed workspaces may not have a resolved path yet.
    # Exclude those entries without discarding unrelated usable workspaces.
    return [workspace for workspace in workspaces
            if isinstance(workspace, dict)
            and isinstance(workspace.get("id"), str)
            and workspace["id"]
            and isinstance(workspace.get("path"), str)
            and Path(workspace["path"]).is_absolute()]


def _workspace_lock(settings, key):
    if any(operation["workspace"] == key and operation["status"] == "needs_attention"
           for operation in settings.get("launchpad_nebi_repairs", {}).values()):
        raise tornado.web.HTTPError(409, log_message="This workspace has an unresolved repair. Click Attempt fix to check its Nebi job again.")
    return settings.setdefault("launchpad_nebi_workspace_locks", {}).setdefault(key, asyncio.Lock())



def _prepare_dependency_repair(
    workspace_dir: Path, manifest: Path, dependencies: List[str], body: Dict[str, Any]
) -> Dict[str, Any]:
    # Nebi's solve and version APIs currently support only pixi.toml.
    if manifest.name != "pixi.toml":
        raise tornado.web.HTTPError(400, log_message="Attempt fix requires pixi.toml. Open this workspace in Nebi.")
    workspace = next((item for item in _tracked_workspaces()
                      if Path(item["path"]).resolve() == workspace_dir), None)
    if workspace is None:
        raise tornado.web.HTTPError(400, log_message="This workspace is not tracked by Nebi. Register it in Nebi before repairing.")
    stage = body.get("repairStage", "plan")
    if stage not in ("plan", "prepare"):
        raise tornado.web.HTTPError(400, log_message="Invalid repair stage")
    if stage == "prepare" and body.get("workspaceId") != workspace["id"]:
        raise tornado.web.HTTPError(409, log_message="The Nebi workspace changed. Refresh and retry.")

    lockfile = workspace_dir / "pixi.lock"
    current = (manifest.read_bytes(), lockfile.read_bytes() if lockfile.exists() else b"")
    versions = _run_json_command(["nebi", "workspace", "version", "list", "--json"], cwd=workspace_dir)
    saved = False
    if versions:
        latest = max(versions, key=lambda version: version["version_number"])
        version = _run_json_command(
            ["nebi", "workspace", "version", "show", str(latest["version_number"]), "--json"],
            cwd=workspace_dir,
        )
        # Server-created versions can have an empty content_hash. Compare the
        # actual files, rather than relying on the CLI's hash-based deduplication.
        saved = current == (version["manifest_content"].encode(), version["lock_file_content"].encode())
    if stage == "plan":
        return {"workspaceId": workspace["id"], "needsSave": not saved, "files": current}
    expected = (body.get("expectedManifest", current[0]), body.get("expectedLock", current[1]))
    # Re-read after the history query: an external edit during that query must
    # not be treated as the saved input. Never roll back a conflicting edit.
    fresh = (manifest.read_bytes(), lockfile.read_bytes() if lockfile.exists() else b"")
    if fresh != current or fresh != expected:
        raise tornado.web.HTTPError(409, log_message="Workspace files changed during repair. Review them in Nebi before retrying.")
    if not saved:
        raise tornado.web.HTTPError(409, log_message="Workspace files changed. Save them in Nebi before retrying Attempt fix.")
    # Declare requirements only. Nebi's solve job owns lockfile resolution.
    # Preserve current files on failure; never restore over concurrent edits.
    _run_command(
        ["pixi", "add", "--frozen", "--no-install", "--manifest-path", str(manifest)] + dependencies,
        cwd=workspace_dir,
    )
    prepared = (manifest.read_bytes(), lockfile.read_bytes() if lockfile.exists() else b"")
    # The caller must run Nebi's solve job to create a version and synchronize
    # package records, then ensure the saved environment is installed.
    return {"workspaceId": workspace["id"], "changed": current != prepared, "files": prepared}


def _validate_nebi_field(
    value: str, pattern: re.Pattern[str], field: str
) -> None:
    if not pattern.fullmatch(value):
        raise tornado.web.HTTPError(400, log_message=f"Invalid Nebi {field}")


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
        # Nebi workspaces may live on a separate volume from the file browser.
        # Trust only an exact path from server-side discovery, not request metadata.
        manager = getattr(server_app, "kernel_spec_manager", None)
        specs = manager.get_all_specs() if manager is not None else {}
        for kernel in specs.values():
            metadata = kernel["spec"].get("metadata", {})
            path = metadata.get("nebi_workspace_path")
            if (
                isinstance(path, str)
                and Path(path).is_absolute()
                and Path(path).resolve() == resolved_dir
            ):
                break
        else:
            raise tornado.web.HTTPError(
                400,
                log_message="Workspace path is outside the Jupyter file browser root "
                "and is not a discovered Nebi workspace",
            )

    if not resolved_dir.is_dir():
        raise tornado.web.HTTPError(400, log_message="Workspace path does not exist")

    return resolved_dir


def _command_output(cmd: List[str], cwd: Optional[Path] = None) -> str:
    try:
        result = subprocess.run(
            cmd,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=300,
        )
    except FileNotFoundError:
        raise tornado.web.HTTPError(500, log_message=f"{cmd[0]} was not found on PATH")
    except subprocess.TimeoutExpired:
        raise tornado.web.HTTPError(500, log_message=f"{cmd[0]} timed out")

    if result.returncode != 0:
        message = (
            result.stderr.strip()
            or result.stdout.strip()
            or f"{cmd[0]} failed"
        )
        raise tornado.web.HTTPError(500, log_message=message)

    return result.stdout


def _run_command(cmd: List[str], cwd: Optional[Path] = None) -> Dict[str, Any]:
    _command_output(cmd, cwd)
    return {"ok": True}


def _run_json_command(cmd: List[str], cwd: Optional[Path] = None) -> Any:
    try:
        return json.loads(_command_output(cmd, cwd))
    except ValueError as error:
        raise tornado.web.HTTPError(502, log_message="Nebi returned invalid JSON") from error


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
        (url_path_join(nebi_url, "repair"), NebiActionHandler,
         {"action": "repair", "server_app": server_app}),
        (url_path_join(nebi_url, "repair", "([a-f0-9]{32})"), NebiRepairStatusHandler),
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
    ]
    web_app.add_handlers(host_pattern, handlers)
