"""External Nebi/Pixi fixtures for server-to-browser integration tests.

The production HTTP handlers, error serialization and frontend are not mocked.
Tests create nebi-test.json inside their temporary workspace to expose a kernel.
"""

import atexit
import json
from pathlib import Path
import shutil
import sys
from tempfile import mkdtemp

from jupyter_client.kernelspec import KernelSpecManager


class NebiTestKernelSpecManager(KernelSpecManager):
    def get_all_specs(self):
        specs = super().get_all_specs()
        for fixture in Path(self.parent.root_dir).glob("*/nebi-test.json"):
            metadata = json.loads(fixture.read_text())
            metadata.update({
                "nebi_workspace_path": str(fixture.parent),
                "pixi_environment": "default",
                "nebi_state": "local-missing-deps",
            })
            specs[fixture.parent.name] = {
                "resource_dir": str(fixture.parent),
                "spec": {
                    "argv": [sys.executable, "-m", "ipykernel_launcher", "-f", "{connection_file}"],
                    "display_name": "Nebi repair integration fixture",
                    "language": "python",
                    "metadata": metadata,
                },
            }
        return specs

    def invalidate_discovery_cache(self):
        # Fixture discovery reads the filesystem on every request.
        pass


def configure_nebi_fixtures(c):
    """Provide deterministic Nebi/Pixi executables without installing packages."""
    import os

    cli_dir = Path(mkdtemp(prefix="launchpad-test-pixi-"))
    atexit.register(shutil.rmtree, cli_dir)
    pixi = cli_dir / "pixi"
    pixi.write_text(
        f"#!{sys.executable}\n"
        "import json, pathlib, sys\n"
        "if sys.argv[1] == 'list': print('[]'); sys.exit(0)\n"
        "path = pathlib.Path('pixi-invocations.json')\n"
        "calls = json.loads(path.read_text()) if path.exists() else []\n"
        "calls.append(sys.argv[1:])\n"
        "path.write_text(json.dumps(calls))\n"
        "if 'example-kernel' in sys.argv:\n"
        "    sys.stderr.write('Could not install example-kernel.\\nPackage is unavailable.\\n')\n"
        "    sys.exit(1)\n"
        "if sys.argv[1] == 'add':\n"
        "    with pathlib.Path('pixi.toml').open('a') as f: f.write('\\n# repaired\\n')\n"
    )
    pixi.chmod(0o755)
    nebi = cli_dir / "nebi"
    nebi.write_text(
        f"#!{sys.executable}\n"
        "import json, pathlib, sys\n"
        f"root = pathlib.Path({str(c.ServerApp.root_dir)!r})\n"
        "if sys.argv[1:4] == ['workspace', 'list', '--json']:\n"
        "    print(json.dumps([{'id': p.parent.name, 'path': str(p.parent)} for p in root.glob('*/nebi-test.json')]))\n"
        "elif sys.argv[1:4] == ['workspace', 'version', 'list']:\n"
        "    print(json.dumps([{'version_number': 1}]))\n"
        "elif sys.argv[1:4] == ['workspace', 'version', 'show']:\n"
        "    print(json.dumps({'manifest_content': pathlib.Path('pixi.toml').read_text(), 'lock_file_content': ''}))\n"
        "else:\n"
        "    sys.exit(1)\n"
    )
    nebi.chmod(0o755)
    os.environ["PATH"] = str(cli_dir) + os.pathsep + os.environ["PATH"]
    c.ServerApp.kernel_spec_manager_class = NebiTestKernelSpecManager
    c.ServerProxy.servers = {
        **dict(c.ServerProxy.servers),
        "nebi": {
            "command": [sys.executable, str(Path(__file__).resolve()), "{port}", str(c.ServerApp.root_dir)],
            "absolute_url": True,
            # Keep the fixture available to repair handlers without adding an
            # application card to unrelated launcher screenshots.
            "launcher_entry": {"enabled": False, "title": "Nebi", "path_info": "nebi/workspaces"},
        },
    }


if __name__ == "__main__":
    from http.server import BaseHTTPRequestHandler, HTTPServer
    from urllib.parse import urlsplit
    root = Path(sys.argv[2])

    class NebiFixtureHandler(BaseHTTPRequestHandler):
        def respond(self, data):
            payload = json.dumps(data).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self):
            path = urlsplit(self.path).path
            if path.endswith("/jobs"):
                self.respond([])
            elif path.endswith("/version"):
                self.respond({"mode": "local"})
            elif "/versions/" in path:
                workspace = root / path.split("/")[-3]
                self.respond(json.loads((workspace / "snapshot.json").read_text()))
            elif path.endswith("/versions"):
                self.respond([{"version_number": 1}])
            elif path.endswith("/packages"):
                self.respond([])
            else:
                workspace = root / path.rsplit("/", 1)[-1]
                self.respond({"path": str(workspace), "install_status": "installed"})

        def do_POST(self):
            parts = urlsplit(self.path).path.split("/")
            workspace = root / parts[-2]
            (workspace / "native-job.json").write_text(json.dumps({"action": parts[-1]}))
            lockfile = workspace / "pixi.lock"
            lockfile.write_text("# Resolved by Nebi\n")
            (workspace / "snapshot.json").write_text(json.dumps({
                "manifest_content": (workspace / "pixi.toml").read_text(),
                "lock_file_content": lockfile.read_text(), "job_id": "fixture-job", "package_metadata": "[]",
            }))
            self.respond({"id": "fixture-job", "status": "completed"})

    HTTPServer(("127.0.0.1", int(sys.argv[1])), NebiFixtureHandler).serve_forever()
