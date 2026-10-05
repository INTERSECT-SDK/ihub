import redis.asyncio as redis

from ihub_server.config import settings


async def init_redis_pool() -> redis.Redis:
    redis_conn = await redis.Redis(
        host=settings.redis_host,
        port=settings.redis_port,
        db=settings.redis_db,
        decode_responses=settings.redis_docode_resp,
        protocol=settings.redis_protocol,
    )
    return redis_conn
