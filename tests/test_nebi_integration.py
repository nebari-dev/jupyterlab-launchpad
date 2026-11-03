"""Opt-in integration test against a disposable local data-science-pack server.

Set LAUNCHPAD_INTEGRATION_URL and LAUNCHPAD_INTEGRATION_TOKEN. The test creates
and deletes its own Nebi workspace; existing workspaces are never modified.
"""
import json
import os
import time
import unittest
from urllib.request import HTTPCookieProcessor, Request, build_opener
from http.cookiejar import CookieJar
from uuid import uuid4


@unittest.skipUnless(os.environ.get("LAUNCHPAD_INTEGRATION_URL"), "Requires a local Nebi integration server")
class NebiRepairIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.client = build_opener(HTTPCookieProcessor(CookieJar()))

    def request(self, path, body=None, method=None):
        data = json.dumps(body).encode() if body is not None else None
        request = Request(
            os.environ["LAUNCHPAD_INTEGRATION_URL"].rstrip("/") + "/" + path,
            data=data, method=method,
            headers={"Authorization": "token " + os.environ["LAUNCHPAD_INTEGRATION_TOKEN"],
                     "Content-Type": "application/json"},
        )
        with self.client.open(request, timeout=300) as response:
            content = response.read()
            return json.loads(content) if content else None

    def wait_job(self, path):
        job = self.request(path, method="POST")
        deadline = time.monotonic() + 300
        while job["status"] in ("pending", "running"):
            self.assertLess(time.monotonic(), deadline, job)
            time.sleep(0.25)
            job = self.request("nebi/api/v1/jobs/" + job["id"])
        self.assertEqual(job["status"], "completed", job)

    def test_native_repair_versions_and_packages(self):
        name = "launchpad-regression-" + uuid4().hex[:10]
        workspace = self.request("nebi/api/v1/workspaces", {
            "name": name,
            "pixi_toml": '[workspace]\nname = "' + name + '"\nchannels = ["conda-forge"]\n'
                         'platforms = ["linux-aarch64"]\n[dependencies]\npython = ">=3.11,<3.12"\n',
        })
        path = "nebi/api/v1/workspaces/" + workspace["id"]
        try:
            deadline = time.monotonic() + 300
            while workspace["status"] in ("pending", "creating"):
                self.assertLess(time.monotonic(), deadline)
                time.sleep(0.25)
                workspace = self.request(path)
            self.assertEqual(workspace["status"], "ready", workspace)
            self.wait_job(path + "/install")
            versions = self.request(path + "/versions")
            self.assertEqual(len(versions), 1)
            original = self.request(path + "/versions/1")
            self.assertFalse(original["content_hash"])
            capabilities = self.request("jupyterlab-launchpad/nebi/capabilities")
            self.assertIn(workspace["path"], capabilities["repairWorkspaces"])
            body = {"workspacePath": workspace["path"], "environment": "default",
                    "repair": True, "notReadyReason": "kernel-not-installed"}
            action = "jupyterlab-launchpad/nebi/repair"
            def repair():
                operation = self.request(action, body)
                deadline = time.monotonic() + 300
                while operation["status"] == "running":
                    self.assertLess(time.monotonic(), deadline, operation)
                    time.sleep(0.25)
                    operation = self.request(action + "/" + operation["id"])
                self.assertEqual(operation["status"], "completed", operation)
            repair()
            self.assertEqual(len(self.request(path + "/versions")), 2)
            after = self.request(path + "/versions/1")
            self.assertEqual(after["manifest_content"], original["manifest_content"])
            self.assertEqual(after["lock_file_content"], original["lock_file_content"])
            repaired = self.request(path + "/versions/2")
            packages = self.request(path + "/packages")
            metadata = json.loads(repaired["package_metadata"])
            recorded = {(p["name"], p["version"]) for p in packages}
            self.assertEqual(recorded, {(p["Name"], p["Version"]) for p in metadata})
            self.assertIn("ipykernel", {p["name"] for p in packages})
            self.assertGreater(len(packages), len(json.loads(original["package_metadata"])))
            repair()
            self.assertEqual(len(self.request(path + "/versions")), 2)
            # Inside the disposable image, remove only this test's installed env.
            # .pixi/envs remains, so Nebi still reports it as installed.
            if os.environ.get("LAUNCHPAD_INTEGRATION_FILESYSTEM") == "1":
                import shutil
                import subprocess
                from pathlib import Path
                environment = Path(workspace["path"]) / ".pixi" / "envs" / "default"
                python = str(environment / "bin" / "python")
                module = Path(subprocess.check_output(
                    [python, "-c", "import ipykernel; print(ipykernel.__path__[0])"], text=True).strip())
                shutil.rmtree(module)
                shutil.rmtree(environment / "share" / "jupyter" / "kernels" / "python3")
                self.assertNotEqual(subprocess.run(
                    [python, "-c", "import ipykernel"], capture_output=True).returncode, 0)
                repair()
                subprocess.run([python, "-c", "import ipykernel"], check=True)
                self.assertTrue((environment / "share/jupyter/kernels/python3/kernel.json").is_file())
                self.assertEqual(len(self.request(path + "/versions")), 2)
                shutil.rmtree(environment)
                self.assertEqual(self.request(path)["install_status"], "installed")
                repair()
                subprocess.run([str(environment / "bin" / "python"), "-c", "import ipykernel"], check=True)
                self.assertEqual(len(self.request(path + "/versions")), 2)
            self.request(path + "/pixi-toml", {"content": repaired["manifest_content"] + "\n# unsaved edit\n"}, "PUT")
            repair()
            self.assertEqual(len(self.request(path + "/versions")), 3)
            print(f"Native repair verified: 1 → 2 versions; {len(packages)} packages synchronized; unchanged retry kept 2 versions.")
        finally:
            self.request(path, method="DELETE")
