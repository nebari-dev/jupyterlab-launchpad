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

    def wait_job(self, path, body=None):
        job = self.request(path, body, method="POST")
        deadline = time.monotonic() + 300
        while job["status"] in ("pending", "running"):
            self.assertLess(time.monotonic(), deadline, job)
            time.sleep(0.25)
            job = self.request("nebi/api/v1/jobs/" + job["id"])
        self.assertEqual(job["status"], "completed", job)
        return job

    def test_native_package_job_creates_version(self):
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
            job = self.wait_job(path + "/packages", {"packages": ["ipykernel"]})
            latest = max(self.request(path + "/versions"), key=lambda version: version["version_number"])
            self.assertEqual(latest["job_id"], job["id"])
            self.assertEqual(len(self.request(path + "/versions")), 2)
            after = self.request(path + "/versions/1")
            self.assertEqual(after["manifest_content"], original["manifest_content"])
            self.assertEqual(after["lock_file_content"], original["lock_file_content"])
            repaired = self.request(path + "/versions/2")
            self.assertIn("ipykernel", repaired["manifest_content"])
            self.assertIn("ipykernel", repaired["lock_file_content"])
        finally:
            self.request(path, method="DELETE")
