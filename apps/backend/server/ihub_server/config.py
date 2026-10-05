import os

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    redis_host: str = os.getenv("REDIS_HOST", "127.0.0.1")
    redis_port: int = int(os.getenv("REDIS_PORT", "6379"))
    redis_db: int = int(os.getenv("REDIS_DB", "0"))
    redis_protocol: int = int(os.getenv("REDIS_PROTOCOL", "3"))
    redis_docode_resp: bool = bool(os.getenv("REDIS_DECODE_RESPONSES", "True"))


settings = Settings()
