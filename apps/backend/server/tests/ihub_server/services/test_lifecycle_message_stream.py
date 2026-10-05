import asyncio
import threading

from ihub_server.services.lifecycle_message_stream import (
    SHUTDOWN,
    LifecycleMessageStreamManager,
)


def test_fans_out_to_multiple_subscribers_and_cleans_up():
    async def scenario():
        manager = LifecycleMessageStreamManager()
        await manager.start()

        async with manager.subscribe() as first, manager.subscribe() as second:
            assert manager.subscriber_count == 2
            manager.publish("message")
            await asyncio.sleep(0)
            assert await first.get() == "message"
            assert await second.get() == "message"

        assert manager.subscriber_count == 0

    asyncio.run(scenario())


def test_replays_only_latest_twenty_messages_in_order():
    async def scenario():
        manager = LifecycleMessageStreamManager()
        await manager.start()
        for index in range(25):
            manager.publish(str(index))
        await asyncio.sleep(0)

        async with manager.subscribe() as queue:
            replay = [queue.get_nowait() for _ in range(20)]
            assert replay == [str(index) for index in range(5, 25)]
            assert queue.empty()

    asyncio.run(scenario())


def test_publication_from_callback_thread_reaches_event_loop():
    async def scenario():
        manager = LifecycleMessageStreamManager()
        await manager.start()
        async with manager.subscribe() as queue:
            thread = threading.Thread(target=manager.publish, args=("thread-message",))
            thread.start()
            thread.join()
            assert await asyncio.wait_for(queue.get(), timeout=1) == "thread-message"

    asyncio.run(scenario())


def test_idle_subscription_stays_open_until_shutdown():
    async def scenario():
        manager = LifecycleMessageStreamManager()
        await manager.start()
        async with manager.subscribe() as queue:
            pending_item = asyncio.create_task(queue.get())
            await asyncio.sleep(0)
            assert not pending_item.done()

            await manager.shutdown()
            assert await pending_item is SHUTDOWN
            assert manager.subscriber_count == 0

    asyncio.run(scenario())
