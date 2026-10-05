import logging
import logging.config

from .environment import Settings


def configure_logging(settings: Settings):
    logging.config.dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "formatters": {
                "standard": {"format": "%(asctime)s [%(levelname)s] %(name)s: %(message)s"},
            },
            "handlers": {
                "default": {
                    "level": settings.LOG_LEVEL,
                    "class": "rich.logging.RichHandler",
                    #'class': 'logging.StreamHandler',
                    "formatter": "standard",
                },
            },
            "loggers": {
                # root logger
                "": {
                    "handlers": ["default"],
                    "level": settings.LOG_LEVEL,
                    "propagate": True,
                },
                "uvicorn.error": {
                    "handlers": ["default"],
                    "level": "INFO",
                    "propagate": False,
                },
                "uvicorn.access": {
                    "handlers": ["default"],
                    "level": "INFO",
                    "propagate": False,
                },
                "pika": {
                    "handlers": ["default"],
                    "level": "WARN",
                    "propagate": False,
                },
                "intersect-sdk-common": {
                    "handlers": ["default"],
                    "propagate": False,
                },
                "ihub-server": {
                    "handlers": ["default"],
                    "level": "INFO",
                    "propagate": False,
                },
            },
        }
    )
