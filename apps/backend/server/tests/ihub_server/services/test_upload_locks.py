import asyncio
from contextlib import asynccontextmanager

import pytest

from ihub_server.services.upload_locks import UploadLockManager


@pytest.mark.parametrize("blocked_path", ["source.icmp", "destination.icmp"])
def test_lock_many_serializes_with_single_path_lock_and_cleanup(blocked_path):
    async def scenario():
        manager = UploadLockManager()
        rename_acquired = asyncio.Event()
        release_rename = asyncio.Event()
        upload_acquired = asyncio.Event()

        async def hold_rename_locks():
            async with manager.lock_many(
                "http://jupyter.example/ijupyterhub",
                "user@example.com",
                ("source.icmp", "destination.icmp"),
            ):
                rename_acquired.set()
                await release_rename.wait()

        async def wait_for_upload_lock():
            await rename_acquired.wait()
            async with manager.lock(
                "http://jupyter.example/ijupyterhub",
                "user@example.com",
                blocked_path,
            ):
                upload_acquired.set()

        rename_task = asyncio.create_task(hold_rename_locks())
        upload_task = asyncio.create_task(wait_for_upload_lock())
        await rename_acquired.wait()
        await asyncio.sleep(0)

        assert upload_acquired.is_set() is False
        assert manager.active_lock_count == 2

        release_rename.set()
        await asyncio.gather(rename_task, upload_task)
        assert upload_acquired.is_set() is True
        assert manager.active_lock_count == 0

    asyncio.run(scenario())


def test_reversed_lock_many_path_sets_do_not_deadlock():
    class YieldingUploadLockManager(UploadLockManager):
        @asynccontextmanager
        async def lock(self, base_url, jupyter_user, contents_path):
            async with super().lock(base_url, jupyter_user, contents_path):
                await asyncio.sleep(0)
                yield

    async def scenario():
        manager = YieldingUploadLockManager()
        start = asyncio.Event()
        acquired = []

        async def acquire_paths(label, paths):
            await start.wait()
            async with manager.lock_many(
                "http://jupyter.example/ijupyterhub",
                "user@example.com",
                paths,
            ):
                acquired.append(label)
                await asyncio.sleep(0)

        first_task = asyncio.create_task(
            acquire_paths("forward", ("source.ichat", "destination.ichat"))
        )
        second_task = asyncio.create_task(
            acquire_paths("reverse", ("destination.ichat", "source.ichat"))
        )
        start.set()

        await asyncio.wait_for(
            asyncio.gather(first_task, second_task),
            timeout=1,
        )
        assert set(acquired) == {"forward", "reverse"}
        assert manager.active_lock_count == 0

    asyncio.run(scenario())


def test_lock_many_deduplicates_paths_and_cleans_up_after_success_or_failure():
    async def scenario():
        manager = UploadLockManager()
        paths = ("source.icmp", "destination.icmp", "source.icmp")

        async with manager.lock_many(
            "http://jupyter.example/ijupyterhub",
            "user@example.com",
            paths,
        ):
            assert manager.active_lock_count == 2
        assert manager.active_lock_count == 0

        with pytest.raises(RuntimeError, match="rename failed"):
            async with manager.lock_many(
                "http://jupyter.example/ijupyterhub",
                "user@example.com",
                paths,
            ):
                assert manager.active_lock_count == 2
                raise RuntimeError("rename failed")
        assert manager.active_lock_count == 0

    asyncio.run(scenario())


def test_lock_many_cancellation_releases_already_acquired_paths():
    async def scenario():
        manager = UploadLockManager()
        destination_acquired = asyncio.Event()
        release_destination = asyncio.Event()

        async def hold_destination():
            async with manager.lock(
                "http://jupyter.example/ijupyterhub",
                "user@example.com",
                "z-destination.icmp",
            ):
                destination_acquired.set()
                await release_destination.wait()

        async def wait_for_both_paths():
            async with manager.lock_many(
                "http://jupyter.example/ijupyterhub",
                "user@example.com",
                ("a-source.icmp", "z-destination.icmp"),
            ):
                raise AssertionError("blocked multi-path lock should not be acquired")

        destination_task = asyncio.create_task(hold_destination())
        await destination_acquired.wait()
        rename_task = asyncio.create_task(wait_for_both_paths())
        while manager.active_lock_count != 2:
            await asyncio.sleep(0)

        rename_task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await rename_task
        assert manager.active_lock_count == 1

        release_destination.set()
        await destination_task
        assert manager.active_lock_count == 0

    asyncio.run(scenario())


def test_hub_root_and_default_user_server_share_a_lock_and_cleanup():
    async def scenario():
        manager = UploadLockManager()
        first_acquired = asyncio.Event()
        release_first = asyncio.Event()
        second_acquired = asyncio.Event()

        async def hold_first_lock():
            async with manager.lock(
                "HTTP://JUPYTER.EXAMPLE/ijupyterhub/?ignored=true#fragment",
                "USER@example.com",
                "projects/project-id/data.json",
            ):
                first_acquired.set()
                await release_first.wait()

        async def wait_for_same_lock():
            await first_acquired.wait()
            async with manager.lock(
                "http://jupyter.example/ijupyterhub/user/user@example.com/",
                "user@example.com",
                "projects/project-id/data.json",
            ):
                second_acquired.set()

        first_task = asyncio.create_task(hold_first_lock())
        second_task = asyncio.create_task(wait_for_same_lock())
        await first_acquired.wait()
        await asyncio.sleep(0)

        assert second_acquired.is_set() is False
        assert manager.active_lock_count == 1

        release_first.set()
        await asyncio.gather(first_task, second_task)
        assert second_acquired.is_set() is True
        assert manager.active_lock_count == 0

    asyncio.run(scenario())


def test_encoded_and_decoded_default_user_servers_share_a_lock_and_cleanup():
    async def scenario():
        manager = UploadLockManager()
        first_acquired = asyncio.Event()
        release_first = asyncio.Event()
        second_acquired = asyncio.Event()

        async def hold_first_lock():
            async with manager.lock(
                "http://jupyter.example/ijupyterhub/user/user%40example.com",
                "user@example.com",
                "projects/project-id/data.json",
            ):
                first_acquired.set()
                await release_first.wait()

        async def wait_for_same_lock():
            await first_acquired.wait()
            async with manager.lock(
                "http://jupyter.example/ijupyterhub/user/user@example.com",
                "user@example.com",
                "projects/project-id/data.json",
            ):
                second_acquired.set()

        first_task = asyncio.create_task(hold_first_lock())
        second_task = asyncio.create_task(wait_for_same_lock())
        await first_acquired.wait()
        await asyncio.sleep(0)

        assert second_acquired.is_set() is False
        assert manager.active_lock_count == 1

        release_first.set()
        await asyncio.gather(first_task, second_task)
        assert second_acquired.is_set() is True
        assert manager.active_lock_count == 0

    asyncio.run(scenario())


def test_named_user_server_is_independently_lockable_and_cleanup():
    async def scenario():
        manager = UploadLockManager()
        default_acquired = asyncio.Event()
        release_default = asyncio.Event()
        named_acquired = asyncio.Event()

        async def hold_default_lock():
            async with manager.lock(
                "http://jupyter.example/ijupyterhub/user/user@example.com",
                "user@example.com",
                "projects/project-id/data.json",
            ):
                default_acquired.set()
                await release_default.wait()

        async def acquire_named_lock():
            await default_acquired.wait()
            async with manager.lock(
                "http://jupyter.example/ijupyterhub/user/user@example.com/lab-server",
                "user@example.com",
                "projects/project-id/data.json",
            ):
                named_acquired.set()

        default_task = asyncio.create_task(hold_default_lock())
        named_task = asyncio.create_task(acquire_named_lock())
        await default_acquired.wait()
        await named_acquired.wait()

        assert default_task.done() is False
        assert named_acquired.is_set() is True

        release_default.set()
        await asyncio.gather(default_task, named_task)
        assert manager.active_lock_count == 0

    asyncio.run(scenario())
