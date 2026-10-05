from ihub_server.services.errors import ServiceError
from ihub_server.tools import retire_guest_jupyter_access as command


def test_main_returns_success(monkeypatch, capsys):
    async def succeed():
        return None

    monkeypatch.setattr(command, "retire_guest_jupyter_access", succeed)

    assert command.main() == 0
    assert "access retired" in capsys.readouterr().out


def test_main_returns_failure_for_service_error(monkeypatch, capsys):
    async def fail():
        raise ServiceError("upstream failed")

    monkeypatch.setattr(command, "retire_guest_jupyter_access", fail)

    assert command.main() == 1
    assert "upstream failed" in capsys.readouterr().err
