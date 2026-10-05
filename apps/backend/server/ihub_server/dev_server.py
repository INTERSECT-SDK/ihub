"""Development server launcher that owns the Uvicorn reload process tree."""

from __future__ import annotations

import os
import signal
import subprocess
import sys

APP_TARGET = "ihub_server.main:app"
HOST = "0.0.0.0"  # noqa: S104 - preserve the existing dev-server bind address.
SHUTDOWN_TIMEOUT_SECONDS = 5.0
WAIT_POLL_SECONDS = 0.2


def build_uvicorn_command(port: str) -> list[str]:
    """Build the Uvicorn reload command used by the backend dev script."""
    return [
        sys.executable,
        "-m",
        "uvicorn",
        APP_TARGET,
        "--reload",
        "--host",
        HOST,
        "--port",
        port,
    ]


def _send_shutdown_signal(process: subprocess.Popen[bytes], signum: int) -> None:
    if os.name != "posix":
        try:
            process.send_signal(signum)
        except ProcessLookupError:
            return
        return

    try:
        process_group_id = os.getpgid(process.pid)
    except ProcessLookupError:
        return

    try:
        os.killpg(process_group_id, signum)
    except ProcessLookupError:
        return


def _kill_process(process: subprocess.Popen[bytes]) -> None:
    if os.name != "posix":
        try:
            process.kill()
        except ProcessLookupError:
            return
        return

    try:
        process_group_id = os.getpgid(process.pid)
    except ProcessLookupError:
        return

    try:
        os.killpg(process_group_id, signal.SIGKILL)
    except ProcessLookupError:
        return


def _wait_for_shutdown(process: subprocess.Popen[bytes]) -> int:
    try:
        return process.wait(timeout=SHUTDOWN_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        _kill_process(process)
        return process.wait()


def run_dev_server() -> int:
    """Run Uvicorn reload and clean up the spawned process group on shutdown."""
    port = os.environ["PORT"]
    shutdown_requested = False

    process = subprocess.Popen(  # noqa: S603
        build_uvicorn_command(port),
        start_new_session=os.name == "posix",
    )

    def handle_shutdown(signum: int, _frame: object) -> None:
        nonlocal shutdown_requested
        shutdown_requested = True
        _send_shutdown_signal(process, signum)

    signals_to_handle = (signal.SIGINT, signal.SIGTERM)
    previous_handlers = {
        handled_signal: signal.signal(handled_signal, handle_shutdown)
        for handled_signal in signals_to_handle
    }

    try:
        while True:
            try:
                return process.wait(timeout=WAIT_POLL_SECONDS)
            except subprocess.TimeoutExpired:
                if shutdown_requested:
                    return _wait_for_shutdown(process)
    finally:
        for handled_signal, previous_handler in previous_handlers.items():
            signal.signal(handled_signal, previous_handler)


def main() -> None:
    raise SystemExit(run_dev_server())


if __name__ == "__main__":
    main()
