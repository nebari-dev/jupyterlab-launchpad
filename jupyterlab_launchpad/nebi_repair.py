"""Server-owned repair orchestration; the browser only submits and polls."""
import asyncio
import json
from pathlib import Path
from typing import Any, Awaitable, Callable
from urllib.parse import quote

from tornado.web import HTTPError
from tornado.httpclient import HTTPClientError
from tornado.ioloop import IOLoop


class IncompletePackageRecords(HTTPError):
    """The saved version or workspace package list disagrees with the lockfile."""

    def __init__(self):
        super().__init__(500, log_message="Nebi package records are incomplete. Retry Attempt fix to recover them.")


class NebiRepair:
    def __init__(self, workspace: Path, prepare: Callable, request: Callable[..., Awaitable[Any]],
                 run_command: Callable, run_json: Callable, wait_for_retry=None):
        self.workspace = workspace
        self.prepare = prepare
        self.request = request
        self.run_command = run_command
        self.run_json = run_json
        self.path = ""
        self.wait_for_retry = wait_for_retry

    def files(self):
        """Read the current manifest and lockfile as a pair of byte strings.

        A missing lockfile is represented by empty bytes. Callers keep this
        pair in memory to compare with later reads or Nebi's saved version.
        """
        manifest = self.workspace / "pixi.toml"
        lockfile = self.workspace / "pixi.lock"
        return (manifest.read_bytes(), lockfile.read_bytes() if lockfile.exists() else b"")

    async def check_files(self, expected):
        """Stop if the working files differ from the previously read contents.

        Read in a worker thread to keep Jupyter responsive. A conflict leaves
        the current files in place; this check does not undo earlier work.
        """
        if await IOLoop.current().run_in_executor(None, self.files) != expected:
            raise HTTPError(409, log_message="Workspace files changed during repair. Review them in Nebi before retrying.")

    async def attention(self, message):
        """Ask the handler to pause until the user clicks Check repair again.

        The handler keeps this workspace reserved while waiting. If no resume
        handler was supplied, report the uncertain outcome as an error.
        """
        if self.wait_for_retry is None:
            raise HTTPError(503, log_message=message)
        await self.wait_for_retry(message)

    @staticmethod
    def retryable(error, *, polling=False):
        """Classify errors for submission recovery or another status check.

        This only returns a decision; it does not retry a request itself.
        """
        code = getattr(error, "status_code", getattr(error, "code", 599))
        # A rate-limited submission was refused; a rate-limited status check
        # tells us nothing about the job already running.
        return code == 408 or (polling and code == 429) or code >= 500

    async def jobs(self):
        """Fetch Nebi's job list and require each entry to have a string ID.

        run_job compares IDs before and after an uncertain submission so
        existing jobs are excluded when trying to recover a missing job ID.
        """
        jobs = await self.request("jobs")
        # Nebi may serialize an empty job list as null.
        if jobs is None:
            return []
        if not isinstance(jobs, list) or any(not isinstance(job, dict) or not isinstance(job.get("id"), str) for job in jobs):
            raise HTTPError(502, log_message="Invalid Nebi job list")
        return jobs

    async def run_job(self, action):
        """Submit one Nebi solve/install job and wait for its terminal status.

        Poll a known job ID every half second, retrying temporary read errors.
        If the submission response is lost, look for a new matching job rather
        than submit again. Pause for user attention when its outcome is unclear.
        Return the completed job, or raise an error for failure or cancellation.
        """
        # Snapshot IDs before submission. If the response is lost, only a new
        # matching job can be adopted; never repeat an uncertain POST.
        previous = {job["id"] for job in await self.jobs()}
        try:
            job = await self.request(self.path + "/" + action, "POST")
        except ConnectionRefusedError as error:
            # No connection was established, so Nebi could not receive this POST.
            raise HTTPError(503, log_message="Connection refused before the Nebi job was submitted. Retry Attempt fix.") from error
        except (HTTPClientError, HTTPError, OSError) as error:
            if not self.retryable(error):
                raise
            job = None
        if not isinstance(job, dict) or not isinstance(job.get("id"), str) or job.get("status") not in ("pending", "running", "completed", "failed", "cancelled"):
            job = None
        while job is None:
            try:
                candidates = [item for item in await self.jobs()
                              if isinstance(item, dict)
                              and isinstance(item.get("id"), str)
                              and item.get("status") in ("pending", "running", "completed", "failed", "cancelled")
                              and item["id"] not in previous
                              and item.get("workspace_id") == self.path.rsplit("/", 1)[-1]
                              and item.get("type") == {"solve": "update", "install": "env_install"}[action]]
            except (HTTPClientError, HTTPError, OSError):
                candidates = []
            if len(candidates) == 1:
                job = candidates[0]
            else:
                await self.attention("Cannot confirm whether Nebi accepted the job. Check jobs in Nebi, then click Attempt fix to check again. No new job will be submitted.")
        failures = 0
        while job.get("status") in ("pending", "running"):
            await asyncio.sleep(0.5)
            try:
                result = await self.request("jobs/" + quote(job["id"], safe=""))
                if not isinstance(result, dict) or result.get("id") != job["id"] or result.get("status") not in ("pending", "running", "completed", "failed", "cancelled"):
                    raise HTTPError(502, log_message="Invalid Nebi job response")
                job = result
                failures = 0
            except (HTTPClientError, HTTPError, OSError) as error:
                failures += 1
                if not self.retryable(error, polling=True) or failures >= 3:
                    await self.attention("Cannot determine the outcome of Nebi job " + job["id"] + ". Check it in Nebi, then click Attempt fix to check again. This workspace remains reserved.")
                    failures = 0
                else:
                    await asyncio.sleep(5)
        if job["status"] != "completed":
            raise HTTPError(500, log_message=job.get("error") or "Nebi repair job failed. Review the workspace in Nebi.")
        return job

    async def verify_saved(self, expected, job_id=None):
        """Check that Nebi saved the expected files and matching package records.

        expected is the manifest/lockfile byte pair read after Nebi's solve,
        or the unchanged saved input when no solve is needed. When job_id is
        supplied, the saved version must also belong to that job. Check package
        names and versions against Pixi's locked list, and detect working-file
        edits before and after verification. A completed job alone is not proof
        that Nebi v0.15 saved all of these records successfully.
        """
        await self.check_files(expected)
        versions = await self.request(self.path + "/versions")
        if not versions:
            raise HTTPError(500, log_message="Repair version was not saved. Review the workspace in Nebi.")
        latest = max(versions, key=lambda item: item["version_number"])
        version = await self.request(self.path + "/versions/" + str(latest["version_number"]))
        saved = (version["manifest_content"].encode(), version["lock_file_content"].encode())
        if saved != expected or (job_id and version.get("job_id") != job_id):
            raise HTTPError(500, log_message="Repair version was not saved as expected. Review the workspace in Nebi.")
        listed = await IOLoop.current().run_in_executor(None, self.run_json,
            ["pixi", "list", "--json", "--locked", "--no-install", "--manifest-path", str(self.workspace / "pixi.toml")], self.workspace)
        expected_packages = {(p["name"], p["version"]) for p in listed}
        metadata = json.loads(version.get("package_metadata") or "[]") or []
        saved_packages = {(p["Name"], p["Version"]) for p in metadata}
        packages = await self.request(self.path + "/packages")
        recorded_packages = {(p["name"], p["version"]) for p in packages}
        if saved_packages != expected_packages or recorded_packages != expected_packages:
            raise IncompletePackageRecords()
        await self.check_files(expected)

    async def solve_and_verify(self, expected):
        """Let Nebi resolve the lockfile and verify its saved result.

        A solve may update the lockfile, but must preserve the input manifest.
        The resulting files must match the snapshot created by this job.
        """
        await self.check_files(expected)
        job = await self.run_job("solve")
        resolved = await IOLoop.current().run_in_executor(None, self.files)
        if resolved[0] != expected[0]:
            raise HTTPError(409, log_message="Workspace manifest changed while saving. Review it in Nebi.")
        await self.verify_saved(resolved, job["id"])
        return resolved

    async def install_status(self, *, allow_uninstalled=True):
        """Return Nebi's installation status after checking the workspace path.

        Stop if an install/uninstall is active or the status is unknown.
        Set allow_uninstalled=False when the workspace started installed, so
        becoming uninstalled during repair is treated as a conflict.
        """
        workspace = await self.request(self.path)
        if Path(workspace["path"]).resolve() != self.workspace:
            raise HTTPError(409, log_message="Launchpad and Nebi refer to different workspace paths.")
        status = workspace.get("install_status")
        if status in ("installing", "uninstalling"):
            raise HTTPError(409, log_message=f"Nebi is {status} this workspace. Wait for that job to finish before retrying.")
        if status == "not_installed" and not allow_uninstalled:
            raise HTTPError(409, log_message="The workspace was uninstalled during repair. Review it in Nebi.")
        if status not in ("installed", "not_installed", "install_failed"):
            raise HTTPError(502, log_message="Nebi did not report a recognized installation status.")
        return status

    async def run(self):
        """Run the complete repair in order and verify the result before success.

        Preserve unsaved input, prepare dependencies, then save and verify any
        changed configuration through Nebi. Recover incomplete package records
        when needed, reinstall locked packages, and require an installed final
        status. Recheck files and installation status between steps to detect
        conflicts. Earlier changes remain in place if a later step fails.
        """
        if (await self.request("version")).get("mode") != "local":
            raise HTTPError(400, log_message="Attempt fix requires a local Nebi service.")
        plan = await IOLoop.current().run_in_executor(None, self.prepare, {"repairStage": "plan"})
        self.path = "workspaces/" + quote(plan["workspaceId"], safe="")
        allow_uninstalled = await self.install_status() == "not_installed"
        before = plan["files"]
        await self.check_files(before)
        if plan["needsSave"]:
            before = await self.solve_and_verify(before)
            await self.install_status(allow_uninstalled=allow_uninstalled)
        await self.check_files(before)
        prepared = await IOLoop.current().run_in_executor(None, self.prepare, {
            "repairStage": "prepare", "workspaceId": plan["workspaceId"],
            "expectedManifest": before[0], "expectedLock": before[1],
        })
        # Preparation changes only the manifest; Nebi resolves the lockfile.
        expected = prepared["files"]
        await self.check_files(expected)
        if prepared["changed"]:
            await self.install_status(allow_uninstalled=allow_uninstalled)
            expected = await self.solve_and_verify(expected)
        else:
            try:
                await self.verify_saved(expected)
            except IncompletePackageRecords:
                # v0.15 has no metadata-only sync API. One native recovery solve
                # rebuilds package records and saves complete snapshot metadata.
                await self.install_status(allow_uninstalled=allow_uninstalled)
                await self.check_files(expected)
                job = await self.run_job("solve")
                await self.verify_saved(expected, job["id"])
        # Ordinary install trusts package metadata even when installed files are
        # missing. Reinstall restores those files without changing the lockfile.
        await self.install_status(allow_uninstalled=allow_uninstalled)
        await self.check_files(expected)
        await IOLoop.current().run_in_executor(None, self.run_command,
            ["pixi", "reinstall", "--locked", "--manifest-path", str(self.workspace / "pixi.toml")], self.workspace)
        await self.verify_saved(expected)
        # Nebi gives its latest failed env-install job precedence over disk state.
        # Record recovery through its public install API, never by rewriting jobs.
        status = await self.install_status()
        if status == "install_failed":
            await self.run_job("install")
            await self.verify_saved(expected)
            status = await self.install_status()
        if status != "installed":
            raise HTTPError(409, log_message="Nebi does not report the workspace as installed after repair. Review it in Nebi.")
        return {"ok": True}
