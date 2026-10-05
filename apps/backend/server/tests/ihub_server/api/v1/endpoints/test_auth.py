from types import SimpleNamespace


def test_guest_auth_route_is_removed(client):
    response = client.post("/api/v1/auth/guest")

    assert response.status_code == 404


def test_stored_guest_session_is_rejected(client, app, monkeypatch):
    class RedisJson:
        async def get(self, _session_id):
            return {
                "role": "guest",
                "subject_id": "legacy-guest",
                "email": "legacy@example.com",
            }

    redis = SimpleNamespace(json=lambda: RedisJson(), ping=lambda: False)
    monkeypatch.setattr(app.state, "redis", redis)
    client.cookies.set("IHUB_SESSION", "legacy-session")

    response = client.get("/api/v1/auth/user")

    assert response.status_code == 401
