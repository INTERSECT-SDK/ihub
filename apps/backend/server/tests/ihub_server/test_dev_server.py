import signal
import subprocess

from ihub_server import dev_server


class FakeProcess:
    def __init__(self, wait_results):
        self.pid = 1234
        self.wait_results = list(wait_results)
        self.wait_calls = []
        self.signal_calls = []
        self.kill_calls = 0

    def wait(self, timeout=None):
        self.wait_calls.append(timeout)
        result = self.wait_results.pop(0)
        if isinstance(result, BaseException):
            raise result
        return result

    def send_signal(self, signum):
        self.signal_calls.append(signum)

    def kill(self):
        self.kill_calls += 1


def test_build_uvicorn_command_uses_reload_host_and_port(monkeypatch):
    monkeypatch.setattr(dev_server.sys, "executable", "/path/to/python")

    assert dev_server.build_uvicorn_command("8010") == [
        "/path/to/python",
        "-m",
        "uvicorn",
        "ihub_server.main:app",
        "--reload",
        "--host",
        "0.0.0.0",
        "--port",
        "8010",
    ]


def test_run_dev_server_returns_child_exit_code_without_kill(monkeypatch):
    fake_process = FakeProcess([7])
    popen_calls = []
    killpg_calls = []

    monkeypatch.setenv("PORT", "8010")
    monkeypatch.setattr(dev_server.sys, "executable", "/path/to/python")
    monkeypatch.setattr(
        dev_server.subprocess,
        "Popen",
        lambda *args, **kwargs: popen_calls.append((args, kwargs)) or fake_process,
    )
    monkeypatch.setattr(dev_server.os, "killpg", lambda *args: killpg_calls.append(args))

    assert dev_server.run_dev_server() == 7
    assert popen_calls == [
        (
            (
                [
                    "/path/to/python",
                    "-m",
                    "uvicorn",
                    "ihub_server.main:app",
                    "--reload",
                    "--host",
                    "0.0.0.0",
                    "--port",
                    "8010",
                ],
            ),
            {"start_new_session": True},
        )
    ]
    assert killpg_calls == []


def test_run_dev_server_forwards_sigint_to_child_process_group(monkeypatch):
    fake_process = FakeProcess([subprocess.TimeoutExpired("wait", 0.2), 0])
    signal_handlers = {}
    killpg_calls = []

    def fake_signal(signum, handler):
        previous_handler = signal_handlers.get(signum, signal.SIG_DFL)
        signal_handlers[signum] = handler
        return previous_handler

    def wait(timeout=None):
        try:
            return FakeProcess.wait(fake_process, timeout)
        except subprocess.TimeoutExpired:
            signal_handlers[signal.SIGINT](signal.SIGINT, None)
            raise

    monkeypatch.setenv("PORT", "8010")
    monkeypatch.setattr(dev_server.subprocess, "Popen", lambda *args, **kwargs: fake_process)
    monkeypatch.setattr(dev_server.os, "getpgid", lambda pid: pid + 1)
    monkeypatch.setattr(dev_server.os, "killpg", lambda *args: killpg_calls.append(args))
    monkeypatch.setattr(dev_server.signal, "signal", fake_signal)
    monkeypatch.setattr(fake_process, "wait", wait)

    assert dev_server.run_dev_server() == 0
    assert killpg_calls == [(1235, signal.SIGINT)]
    assert fake_process.wait_calls == [
        dev_server.WAIT_POLL_SECONDS,
        dev_server.SHUTDOWN_TIMEOUT_SECONDS,
    ]


def test_run_dev_server_forwards_sigterm_to_child_process_group(monkeypatch):
    fake_process = FakeProcess([subprocess.TimeoutExpired("wait", 0.2), 0])
    signal_handlers = {}
    killpg_calls = []

    def fake_signal(signum, handler):
        previous_handler = signal_handlers.get(signum, signal.SIG_DFL)
        signal_handlers[signum] = handler
        return previous_handler

    def wait(timeout=None):
        try:
            return FakeProcess.wait(fake_process, timeout)
        except subprocess.TimeoutExpired:
            if len(fake_process.wait_calls) == 1:
                signal_handlers[signal.SIGTERM](signal.SIGTERM, None)
            raise

    monkeypatch.setenv("PORT", "8010")
    monkeypatch.setattr(dev_server.subprocess, "Popen", lambda *args, **kwargs: fake_process)
    monkeypatch.setattr(dev_server.os, "getpgid", lambda pid: pid + 1)
    monkeypatch.setattr(dev_server.os, "killpg", lambda *args: killpg_calls.append(args))
    monkeypatch.setattr(dev_server.signal, "signal", fake_signal)
    monkeypatch.setattr(fake_process, "wait", wait)

    assert dev_server.run_dev_server() == 0
    assert killpg_calls == [(1235, signal.SIGTERM)]
    assert fake_process.wait_calls == [
        dev_server.WAIT_POLL_SECONDS,
        dev_server.SHUTDOWN_TIMEOUT_SECONDS,
    ]


def test_run_dev_server_forwards_sigint_to_child_process_on_non_posix(monkeypatch):
    fake_process = FakeProcess([subprocess.TimeoutExpired("wait", 0.2), 0])
    signal_handlers = {}
    popen_calls = []

    def fake_signal(signum, handler):
        previous_handler = signal_handlers.get(signum, signal.SIG_DFL)
        signal_handlers[signum] = handler
        return previous_handler

    def wait(timeout=None):
        try:
            return FakeProcess.wait(fake_process, timeout)
        except subprocess.TimeoutExpired:
            signal_handlers[signal.SIGINT](signal.SIGINT, None)
            raise

    monkeypatch.setenv("PORT", "8010")
    monkeypatch.setattr(dev_server.os, "name", "nt")
    monkeypatch.setattr(dev_server.os, "getpgid", lambda pid: (_ for _ in ()).throw(AssertionError))
    monkeypatch.setattr(
        dev_server.os, "killpg", lambda *args: (_ for _ in ()).throw(AssertionError)
    )
    monkeypatch.setattr(
        dev_server.subprocess,
        "Popen",
        lambda *args, **kwargs: popen_calls.append((args, kwargs)) or fake_process,
    )
    monkeypatch.setattr(dev_server.signal, "signal", fake_signal)
    monkeypatch.setattr(fake_process, "wait", wait)

    assert dev_server.run_dev_server() == 0
    assert popen_calls[0][1]["start_new_session"] is False
    assert fake_process.signal_calls == [signal.SIGINT]
    assert fake_process.wait_calls == [
        dev_server.WAIT_POLL_SECONDS,
        dev_server.SHUTDOWN_TIMEOUT_SECONDS,
    ]


def test_run_dev_server_kills_child_process_after_timeout_on_non_posix(monkeypatch):
    fake_process = FakeProcess(
        [
            subprocess.TimeoutExpired("wait", 0.2),
            subprocess.TimeoutExpired("wait", dev_server.SHUTDOWN_TIMEOUT_SECONDS),
            -9,
        ]
    )
    signal_handlers = {}

    def fake_signal(signum, handler):
        previous_handler = signal_handlers.get(signum, signal.SIG_DFL)
        signal_handlers[signum] = handler
        return previous_handler

    def wait(timeout=None):
        try:
            return FakeProcess.wait(fake_process, timeout)
        except subprocess.TimeoutExpired:
            if len(fake_process.wait_calls) == 1:
                signal_handlers[signal.SIGTERM](signal.SIGTERM, None)
            raise

    monkeypatch.setenv("PORT", "8010")
    monkeypatch.setattr(dev_server.os, "name", "nt")
    monkeypatch.setattr(dev_server.os, "getpgid", lambda pid: (_ for _ in ()).throw(AssertionError))
    monkeypatch.setattr(
        dev_server.os, "killpg", lambda *args: (_ for _ in ()).throw(AssertionError)
    )
    monkeypatch.setattr(dev_server.subprocess, "Popen", lambda *args, **kwargs: fake_process)
    monkeypatch.setattr(dev_server.signal, "signal", fake_signal)
    monkeypatch.setattr(fake_process, "wait", wait)

    assert dev_server.run_dev_server() == -9
    assert fake_process.signal_calls == [signal.SIGTERM]
    assert fake_process.kill_calls == 1
    assert fake_process.wait_calls == [
        dev_server.WAIT_POLL_SECONDS,
        dev_server.SHUTDOWN_TIMEOUT_SECONDS,
        None,
    ]


def test_run_dev_server_kills_process_group_after_timeout(monkeypatch):
    fake_process = FakeProcess(
        [
            subprocess.TimeoutExpired("wait", 0.2),
            subprocess.TimeoutExpired("wait", dev_server.SHUTDOWN_TIMEOUT_SECONDS),
            -signal.SIGKILL,
        ]
    )
    signal_handlers = {}
    killpg_calls = []

    def fake_signal(signum, handler):
        previous_handler = signal_handlers.get(signum, signal.SIG_DFL)
        signal_handlers[signum] = handler
        return previous_handler

    def wait(timeout=None):
        try:
            return FakeProcess.wait(fake_process, timeout)
        except subprocess.TimeoutExpired:
            if len(fake_process.wait_calls) == 1:
                signal_handlers[signal.SIGTERM](signal.SIGTERM, None)
            raise

    monkeypatch.setenv("PORT", "8010")
    monkeypatch.setattr(dev_server.subprocess, "Popen", lambda *args, **kwargs: fake_process)
    monkeypatch.setattr(dev_server.os, "getpgid", lambda pid: pid + 1)
    monkeypatch.setattr(dev_server.os, "killpg", lambda *args: killpg_calls.append(args))
    monkeypatch.setattr(dev_server.signal, "signal", fake_signal)
    monkeypatch.setattr(fake_process, "wait", wait)

    assert dev_server.run_dev_server() == -signal.SIGKILL
    assert killpg_calls == [(1235, signal.SIGTERM), (1235, signal.SIGKILL)]
    assert fake_process.wait_calls == [
        dev_server.WAIT_POLL_SECONDS,
        dev_server.SHUTDOWN_TIMEOUT_SECONDS,
        None,
    ]
