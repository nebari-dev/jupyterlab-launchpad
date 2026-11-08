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
                "nebi_workspace_path": str(fixture.parent.resolve()),
                "pixi_environment": "default",
                "nebi_state": "ready" if (fixture.parent / "ready").exists() else "local-missing-deps",
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
    pixi.write_text(f"#!{sys.executable}\nimport sys\nsys.exit(0)\n")
    pixi.chmod(0o755)
    nebi = cli_dir / "nebi"
    nebi.write_text(f"#!{sys.executable}\nimport sys\nsys.exit(0)\n")
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
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    from threading import Timer
    from urllib.parse import urlsplit
    from uuid import uuid4
    root = Path(sys.argv[2]).resolve()
    jobs = {}

    class NebiFixtureHandler(BaseHTTPRequestHandler):
        def respond(self, data, status=200):
            payload = json.dumps(data).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self):
            path = urlsplit(self.path).path
            if path.endswith("/version"):
                self.respond({"mode": "local"})
            elif path.endswith("/workspaces"):
                self.respond([{"id": p.parent.name, "path": str(p.parent)}
                              for p in root.glob("*/nebi-test.json")])
            elif "/jobs/" in path:
                self.respond(jobs[path.rsplit("/", 1)[-1]])
            elif path.endswith("/versions"):
                snapshot = root / path.split("/")[-2] / "snapshot.json"
                self.respond(json.loads(snapshot.read_text()) if snapshot.exists() else [])
            else:
                self.respond({"error": "Not found"}, 404)

        def do_POST(self):
            parts = urlsplit(self.path).path.split("/")
            if parts[-1] != "packages":
                return self.respond({"error": "Unexpected action"}, 400)
            workspace = root / parts[-2]
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            packages = body["packages"]
            (workspace / "native-job.json").write_text(json.dumps({"action": "packages", **body}))
            identifier = uuid4().hex
            job = {"id": identifier, "status": "running"}
            jobs[identifier] = job

            def finish():
                if "example-kernel" in packages:
                    job.update(status="failed", error="Could not install example-kernel.\nPackage is unavailable.")
                    return
                (workspace / "snapshot.json").write_text(json.dumps([
                    {"version_number": 1, "job_id": "original"},
                    {"version_number": 2, "job_id": "other" if "missing-version" in packages else identifier},
                ]))
                if "ipykernel" in packages or "r-irkernel" in packages:
                    (workspace / "ready").touch()
                job["status"] = "completed"

            Timer(0.25, finish).start()
            self.respond(job, 202)

    ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), NebiFixtureHandler).serve_forever()
