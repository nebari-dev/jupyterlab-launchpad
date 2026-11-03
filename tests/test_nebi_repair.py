import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, Mock, patch

from tornado.web import HTTPError
from tornado.httpclient import HTTPClientError

from jupyterlab_launchpad.nebi_repair import NebiRepair


class NebiRepairTests(IsolatedAsyncioTestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.workspace = Path(temporary.name).resolve()
        self.manifest = self.workspace / 'pixi.toml'
        self.lock = self.workspace / 'pixi.lock'
        self.manifest.write_text('original')
        self.lock.write_text('lock')
        self.packages = [{'name': 'ipykernel', 'version': '7'}]
        self.changed = True
        self.needs_save = False
        self.saved = []
        self.snapshot('initial')
        self.command = Mock(return_value={'ok': True})
        self.request = AsyncMock(side_effect=self.respond)
        self.repair = NebiRepair(self.workspace, self.prepare, self.request,
                                 self.command, Mock(return_value=self.packages))

    def files(self):
        return self.manifest.read_bytes(), self.lock.read_bytes()

    def snapshot(self, job_id):
        self.saved.append({
            'version_number': len(self.saved) + 1, 'job_id': job_id,
            'manifest_content': self.manifest.read_text(),
            'lock_file_content': self.lock.read_text(),
            'package_metadata': json.dumps([{'Name': 'ipykernel', 'Version': '7'}]),
        })

    def prepare(self, stage):
        if stage['repairStage'] == 'plan':
            return {'workspaceId': 'workspace', 'needsSave': self.needs_save, 'files': self.files()}
        self.assertEqual(self.files(), (stage['expectedManifest'], stage['expectedLock']))
        if self.changed:
            self.manifest.write_text('repaired')
        return {'files': self.files(), 'changed': self.changed}

    async def respond(self, path, method='GET'):
        if path == 'jobs':
            return []
        if path == 'version':
            return {'mode': 'local'}
        if path == 'workspaces/workspace':
            return {'path': str(self.workspace), 'install_status': 'installed'}
        if path.endswith('/solve'):
            job_id = 'job-' + str(len(self.saved))
            self.snapshot(job_id)
            return {'id': job_id, 'status': 'completed'}
        if path.endswith('/versions'):
            return self.saved
        if '/versions/' in path:
            return self.saved[int(path.rsplit('/', 1)[1]) - 1]
        if path.endswith('/packages'):
            return self.packages
        raise AssertionError(path)

    async def test_changed_repair_verifies_snapshot_and_packages_before_install(self):
        await self.repair.run()
        self.assertEqual(len(self.saved), 2)
        self.command.assert_called_once_with(
            ['pixi', 'reinstall', '--locked', '--manifest-path', str(self.manifest)], self.workspace)

    async def test_busy_workspace_is_rejected_before_changes(self):
        for status in ('installing', 'uninstalling'):
            with self.subTest(status=status):
                async def busy(path, method='GET'):
                    result = await self.respond(path, method)
                    if path == 'workspaces/workspace':
                        result['install_status'] = status
                    return result
                self.request.side_effect = busy
                with self.assertRaises(HTTPError) as caught:
                    await self.repair.run()
                self.assertEqual(caught.exception.status_code, 409)
                self.assertEqual(self.manifest.read_text(), 'original')
                self.assertEqual(len(self.saved), 1)
                self.command.assert_not_called()

    async def test_uninstall_started_during_verification_prevents_reinstall(self):
        for status in ('uninstalling', 'not_installed'):
            with self.subTest(status=status):
                uninstall_started = False
                async def respond(path, method='GET'):
                    nonlocal uninstall_started
                    result = await self.respond(path, method)
                    if path.endswith('/packages'):
                        uninstall_started = True
                    elif path == 'workspaces/workspace' and uninstall_started:
                        result['install_status'] = status
                    return result
                self.request.side_effect = respond
                with self.assertRaises(HTTPError) as caught:
                    await self.repair.run()
                self.assertEqual(caught.exception.status_code, 409)
                self.command.assert_not_called()

    async def test_workspace_that_starts_uninstalled_can_be_repaired(self):
        async def respond(path, method='GET'):
            result = await self.respond(path, method)
            if path == 'workspaces/workspace' and not self.command.called:
                result['install_status'] = 'not_installed'
            return result
        self.request.side_effect = respond
        self.assertEqual(await self.repair.run(), {'ok': True})
        self.command.assert_called_once()

    async def test_reinstall_must_end_with_installed_workspace(self):
        async def respond(path, method='GET'):
            result = await self.respond(path, method)
            if path == 'workspaces/workspace' and self.command.called:
                result['install_status'] = 'not_installed'
            return result
        self.request.side_effect = respond
        with self.assertRaises(HTTPError):
            await self.repair.run()
        self.command.assert_called_once()

    async def test_completed_job_without_snapshot_is_not_success(self):
        async def missing_snapshot(path, method='GET'):
            if path.endswith('/solve'):
                return {'id': 'unsaved-job', 'status': 'completed'}
            return await self.respond(path, method)
        self.request.side_effect = missing_snapshot
        with self.assertRaisesRegex(HTTPError, 'version was not saved'):
            await self.repair.run()
        self.command.assert_not_called()
        self.assertEqual(self.manifest.read_text(), 'repaired')

    async def test_correct_job_with_wrong_saved_files_is_not_success(self):
        for field in ('manifest_content', 'lock_file_content'):
            with self.subTest(field=field):
                async def wrong_content(path, method='GET'):
                    result = await self.respond(path, method)
                    if path.endswith('/solve'):
                        # Keep the correct job ID and package metadata so only
                        # the saved-file comparison can reject this snapshot.
                        self.saved[-1][field] = 'incorrect saved content'
                    return result
                self.request.side_effect = wrong_content
                with self.assertRaisesRegex(HTTPError, 'version was not saved'):
                    await self.repair.run()
                self.command.assert_not_called()
                self.assertEqual(self.files(), (b'repaired', b'lock'))

    async def test_failed_package_sync_is_not_success(self):
        async def missing_packages(path, method='GET'):
            if path.endswith('/packages'):
                return []
            return await self.respond(path, method)
        self.request.side_effect = missing_packages
        with self.assertRaisesRegex(HTTPError, 'package records are incomplete'):
            await self.repair.run()
        self.command.assert_not_called()

    async def test_unchanged_installed_environment_runs_locked_reinstall(self):
        self.changed = False
        await self.repair.run()
        self.assertEqual(len(self.saved), 1)
        self.command.assert_called_once()
        self.assertIn('--locked', self.command.call_args.args[0])
        self.assertFalse(any(call.args[0].endswith('/solve') for call in self.request.call_args_list))

    async def test_unsaved_input_is_saved_before_repair(self):
        self.needs_save = True
        self.manifest.write_text('unsaved user edit')
        await self.repair.run()
        self.assertEqual(len(self.saved), 3)
        self.assertEqual(self.saved[1]['manifest_content'], 'unsaved user edit')
        self.assertEqual(self.saved[2]['manifest_content'], 'repaired')

    async def test_external_edit_after_plan_stops_before_prepare(self):
        original_prepare = self.prepare
        def prepare(stage):
            result = original_prepare(stage)
            self.manifest.write_text('external edit')
            return result
        self.repair.prepare = prepare
        with self.assertRaisesRegex(HTTPError, 'files changed during repair'):
            await self.repair.run()
        self.assertEqual(self.manifest.read_text(), 'external edit')
        self.command.assert_not_called()

    async def test_external_edit_during_verification_is_preserved_and_reported(self):
        async def edit_during_check(path, method='GET'):
            result = await self.respond(path, method)
            if path.endswith('/packages'):
                self.manifest.write_text('external edit')
            return result
        self.request.side_effect = edit_during_check
        with self.assertRaisesRegex(HTTPError, 'files changed during repair'):
            await self.repair.run()
        self.assertEqual(self.manifest.read_text(), 'external edit')
        self.command.assert_not_called()

    async def test_different_job_with_identical_files_does_not_confirm_our_save(self):
        async def wrong_job(path, method='GET'):
            result = await self.respond(path, method)
            if path.endswith('/solve'):
                self.saved[-1]['job_id'] = 'another-job'
            return result
        self.request.side_effect = wrong_job
        with self.assertRaisesRegex(HTTPError, 'version was not saved'):
            await self.repair.run()
        self.command.assert_not_called()

    async def test_unchanged_retry_recovers_package_records_once(self):
        self.changed = False
        synced = False
        async def recover(path, method='GET'):
            nonlocal synced
            if path.endswith('/packages') and not synced:
                return []
            result = await self.respond(path, method)
            if path.endswith('/solve'):
                synced = True
            return result
        self.request.side_effect = recover
        await self.repair.run()
        self.assertEqual(len(self.saved), 2)
        await self.repair.run()
        self.assertEqual(len(self.saved), 2, 'Healthy retry must not add another version')

    async def test_unchanged_retry_recovers_incomplete_snapshot_metadata(self):
        self.changed = False
        self.saved[-1]['package_metadata'] = '[]'
        await self.repair.run()
        self.assertEqual(len(self.saved), 2)
        self.assertNotEqual(self.saved[-1]['package_metadata'], '[]')

    async def test_native_install_records_recovery_from_failed_install(self):
        failed = True
        async def recover(path, method='GET'):
            nonlocal failed
            if path == 'workspaces/workspace':
                return {'path': str(self.workspace), 'install_status': 'install_failed' if failed else 'installed'}
            if path.endswith('/install'):
                failed = False
                return {'id': 'install-job', 'status': 'completed'}
            return await self.respond(path, method)
        self.request.side_effect = recover
        await self.repair.run()
        self.assertFalse(failed)
        self.assertEqual(len(self.saved), 2)
        self.assertIn('reinstall', self.command.call_args.args[0])

    async def test_job_keeps_waiting_through_long_duration_and_poll_failure(self):
        self.repair.path = 'workspaces/workspace'
        self.request.side_effect = [
            [],
            {'id': 'slow-job', 'status': 'pending'},
            HTTPClientError(599, 'Timeout'),
            {'id': 'slow-job', 'status': 'running'},
            {'id': 'slow-job', 'status': 'completed'},
        ]
        elapsed = 0
        async def long_sleep(seconds):
            nonlocal elapsed
            elapsed += 700
        with patch('jupyterlab_launchpad.nebi_repair.asyncio.sleep', side_effect=long_sleep):
            result = await self.repair.run_job('solve')
        self.assertGreater(elapsed, 600)
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(sum(call.args[-1] == 'POST' for call in self.request.call_args_list), 1)

    async def test_native_job_failure_is_not_retried_as_another_job(self):
        self.repair.path = 'workspaces/workspace'
        self.request.side_effect = [
            [],
            {'id': 'job', 'status': 'pending'},
            {'id': 'job', 'status': 'failed', 'error': 'solver failed'},
        ]
        with patch('jupyterlab_launchpad.nebi_repair.asyncio.sleep', new_callable=AsyncMock):
            with self.assertRaisesRegex(HTTPError, 'solver failed'):
                await self.repair.run_job('solve')
        self.assertEqual(self.request.call_count, 3)

    async def test_native_job_can_run_longer_than_former_ten_minute_deadline(self):
        from types import SimpleNamespace
        self.repair.path = 'workspaces/workspace'
        self.request.side_effect = [
            [],
            {'id': 'long-job', 'status': 'pending'},
            {'id': 'long-job', 'status': 'running'},
            {'id': 'long-job', 'status': 'completed'},
        ]
        elapsed = 0
        async def advance_clock(seconds):
            nonlocal elapsed
            elapsed += 700
        # The former implementation read this module clock and stopped at 600s.
        clock = SimpleNamespace(monotonic=lambda: elapsed)
        with patch('jupyterlab_launchpad.nebi_repair.time', clock, create=True), patch(
                'jupyterlab_launchpad.nebi_repair.asyncio.sleep', side_effect=advance_clock):
            result = await self.repair.run_job('solve')
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(elapsed, 1400)

    async def test_lost_submission_response_adopts_only_new_matching_job(self):
        self.repair.path = 'workspaces/workspace'
        for action, job_type, wrong_type in (
                ('solve', 'update', 'env_install'),
                ('install', 'env_install', 'update')):
            with self.subTest(action=action):
                self.request.reset_mock()
                accepted = {'id': 'accepted', 'workspace_id': 'workspace',
                            'type': job_type, 'status': 'running'}
                old = {**accepted, 'id': 'old', 'status': 'completed'}
                self.request.side_effect = [
                    [old], HTTPClientError(599, 'response lost'),
                    [old, accepted,
                     {**accepted, 'id': 'wrong-type', 'type': wrong_type},
                     {**accepted, 'id': 'unrelated', 'workspace_id': 'other'}],
                    {**accepted, 'status': 'completed'},
                ]
                with patch('jupyterlab_launchpad.nebi_repair.asyncio.sleep', new_callable=AsyncMock):
                    result = await self.repair.run_job(action)
                self.assertEqual(result['id'], 'accepted')
                posts = [call.args for call in self.request.await_args_list
                         if len(call.args) == 2 and call.args[1] == 'POST']
                self.assertEqual(posts, [('workspaces/workspace/' + action, 'POST')])

    async def test_poll_response_for_another_job_does_not_complete_our_job(self):
        self.repair.path = 'workspaces/workspace'
        self.request.side_effect = [
            [], {'id': 'our-job', 'status': 'running'},
            {'id': 'another-job', 'status': 'completed'},
            {'id': 'our-job', 'status': 'completed'},
        ]
        with patch('jupyterlab_launchpad.nebi_repair.asyncio.sleep', new_callable=AsyncMock):
            result = await self.repair.run_job('solve')
        self.assertEqual(result['id'], 'our-job')
        self.assertEqual([call.args for call in self.request.await_args_list], [
            ('jobs',), ('workspaces/workspace/solve', 'POST'),
            ('jobs/our-job',), ('jobs/our-job',),
        ])

    async def test_unknown_submission_stays_reserved_and_checks_again_without_post(self):
        self.repair.path = 'workspaces/workspace'
        accepted = {'id': 'accepted', 'workspace_id': 'workspace', 'type': 'update', 'status': 'completed'}
        self.request.side_effect = [[], HTTPClientError(599, 'lost'), [], [accepted]]
        self.repair.wait_for_retry = AsyncMock()
        result = await self.repair.run_job('solve')
        self.assertEqual(result, accepted)
        self.repair.wait_for_retry.assert_awaited_once()
        self.assertEqual(sum(len(call.args) == 2 and call.args[1] == 'POST' for call in self.request.call_args_list), 1)

    async def test_ambiguous_submission_does_not_guess_a_job(self):
        self.repair.path = 'workspaces/workspace'
        candidate = {'workspace_id': 'workspace', 'type': 'update', 'status': 'completed'}
        self.request.side_effect = [[], HTTPClientError(599, 'lost'),
                                   [{**candidate, 'id': 'one'}, {**candidate, 'id': 'two'}]]
        with self.assertRaisesRegex(HTTPError, 'Cannot confirm whether'):
            await self.repair.run_job('solve')

    async def test_rejected_submission_does_not_enter_uncertain_state(self):
        self.repair.path = 'workspaces/workspace'
        self.request.side_effect = [[], HTTPError(400, log_message='invalid workspace')]
        self.repair.wait_for_retry = AsyncMock()
        with self.assertRaisesRegex(HTTPError, 'invalid workspace'):
            await self.repair.run_job('solve')
        self.repair.wait_for_retry.assert_not_awaited()

    async def test_permanent_poll_failure_requests_attention_instead_of_looping(self):
        self.repair.path = 'workspaces/workspace'
        self.request.side_effect = [[], {'id': 'job', 'status': 'running'}, HTTPError(404),
                                   {'id': 'job', 'status': 'completed'}]
        self.repair.wait_for_retry = AsyncMock()
        with patch('jupyterlab_launchpad.nebi_repair.asyncio.sleep', new_callable=AsyncMock):
            result = await self.repair.run_job('solve')
        self.repair.wait_for_retry.assert_awaited_once()
        self.assertEqual(result['status'], 'completed')
