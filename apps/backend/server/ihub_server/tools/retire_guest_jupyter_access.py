"""Revoke legacy Guest Mode JupyterHub access without deleting user data."""

import asyncio
import sys

from ihub_server.services.errors import ServiceError
from ihub_server.services.jupyterhub import JupyterHubService

GUEST_JUPYTER_USER = "guest@ihub.local"


async def retire_guest_jupyter_access() -> None:
    """Revoke guest tokens and stop the guest's default Jupyter server."""
    await JupyterHubService().retire_user_access(GUEST_JUPYTER_USER)


def main() -> int:
    """Run the retirement operation and return a process exit status."""
    try:
        asyncio.run(retire_guest_jupyter_access())
    except ServiceError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print("Guest JupyterHub access retired.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
