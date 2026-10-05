from datetime import UTC, datetime
from types import SimpleNamespace

from ihub_server.api.deps import get_campaign_service, get_principal
from ihub_server.models.campaign_run import CampaignRunStatus
from ihub_server.services.errors import NotFoundError, UnsupportedCampaignFormatError


def test_campaign_events_websocket_route(client, app):
    captured = {}

    class FakeCampaignService:
        async def relay_campaign_events(self, broker_id, websocket):
            captured["broker_id"] = broker_id
            await websocket.send_text('{"status":"ok"}')

    app.dependency_overrides[get_campaign_service] = lambda: FakeCampaignService()
    try:
        with client.websocket_connect("/api/v1/campaign/42/events") as websocket:
            assert websocket.receive_text() == '{"status":"ok"}'
    finally:
        app.dependency_overrides.clear()

    assert captured["broker_id"] == 42


def _principal(email="user@example.com"):
    return SimpleNamespace(subject_id="subject", email=email)


def test_start_campaign_passes_principal_email(client, app):
    captured = {}

    class FakeCampaignService:
        async def start_campaign(self, broker_id, payload, user_email):
            captured["broker_id"] = broker_id
            captured["payload"] = payload
            captured["user_email"] = user_email
            return {"status": "ok", "campaign_id": "campaign-1"}

    app.dependency_overrides[get_campaign_service] = lambda: FakeCampaignService()
    app.dependency_overrides[get_principal] = lambda: _principal()
    try:
        response = client.post("/api/v1/campaign/42/start", json={"campaign": "data"})
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "campaign_id": "campaign-1"}
    assert captured == {
        "broker_id": 42,
        "payload": {"campaign": "data"},
        "user_email": "user@example.com",
    }


def test_start_campaign_maps_unsupported_format_to_422(client, app):
    class FakeCampaignService:
        async def start_campaign(self, broker_id, payload, user_email):
            raise UnsupportedCampaignFormatError(
                "Legacy campaign format is no longer supported. Submit a CampaignModel "
                "document with task_groups."
            )

    app.dependency_overrides[get_campaign_service] = lambda: FakeCampaignService()
    app.dependency_overrides[get_principal] = lambda: _principal()
    try:
        response = client.post(
            "/api/v1/campaign/42/start",
            json={"campaignId": "legacy", "nodes": [], "edges": []},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422
    assert response.json() == {
        "detail": "Legacy campaign format is no longer supported. Submit a "
        "CampaignModel document with task_groups."
    }


def test_stop_campaign_passes_campaign_run_id(client, app):
    captured = {}

    class FakeCampaignService:
        async def stop_campaign(self, broker_id, campaign_run_id, user_email):
            captured["broker_id"] = broker_id
            captured["campaign_run_id"] = campaign_run_id
            captured["user_email"] = user_email
            return {"status": "stopped"}

    app.dependency_overrides[get_campaign_service] = lambda: FakeCampaignService()
    app.dependency_overrides[get_principal] = lambda: _principal()
    try:
        response = client.post("/api/v1/campaign/42/stop/run-123")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {"status": "stopped"}
    assert captured == {
        "broker_id": 42,
        "campaign_run_id": "run-123",
        "user_email": "user@example.com",
    }


def test_list_campaign_runs_scopes_to_current_user_and_campaign_filter(client, app):
    captured = {}
    run_at = datetime(2026, 5, 21, tzinfo=UTC)

    class FakeCampaignService:
        def list_runs(
            self,
            user_email,
            campaign_id,
            statuses,
            offset,
            limit,
            campaign_name=None,
            search=None,
        ):
            captured["user_email"] = user_email
            captured["campaign_id"] = campaign_id
            captured["campaign_name"] = campaign_name
            captured["search"] = search
            captured["statuses"] = statuses
            captured["offset"] = offset
            captured["limit"] = limit
            return [
                {
                    "id": 1,
                    "user_email": user_email,
                    "campaign_id": campaign_id,
                    "run_id": "run-1",
                    "run_at": run_at,
                    "orchestrator_url": "http://orchestrator",
                    "status": "ACTIVE",
                    "ended_at": None,
                    "campaign_name": "Campaign 1",
                    "broker_id": 42,
                }
            ]

    app.dependency_overrides[get_campaign_service] = lambda: FakeCampaignService()
    app.dependency_overrides[get_principal] = lambda: _principal("owner@example.com")
    try:
        response = client.get(
            "/api/v1/campaign/runs?campaign_id=campaign-1&status=ACTIVE"
            "&status=COMPLETED&campaign_name=Beam%20Test&search=RUN-12&offset=5&limit=20"
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()[0]["run_id"] == "run-1"
    assert captured == {
        "user_email": "owner@example.com",
        "campaign_id": "campaign-1",
        "campaign_name": "Beam Test",
        "search": "RUN-12",
        "statuses": [CampaignRunStatus.ACTIVE, CampaignRunStatus.COMPLETED],
        "offset": 5,
        "limit": 20,
    }


def test_list_campaign_runs_without_search_remains_compatible(client, app):
    captured = {}

    class FakeCampaignService:
        def list_runs(
            self,
            user_email,
            campaign_id,
            statuses,
            offset,
            limit,
            campaign_name=None,
            search=None,
        ):
            captured["campaign_name"] = campaign_name
            captured["search"] = search
            return []

    app.dependency_overrides[get_campaign_service] = lambda: FakeCampaignService()
    app.dependency_overrides[get_principal] = lambda: _principal()
    try:
        response = client.get("/api/v1/campaign/runs")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == []
    assert captured["campaign_name"] is None
    assert captured["search"] is None


def test_list_campaign_runs_rejects_unknown_status(client, app):
    app.dependency_overrides[get_principal] = lambda: _principal()
    try:
        response = client.get("/api/v1/campaign/runs?status=FAILED")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422


def test_get_campaign_run_returns_404_for_missing_or_not_owned_run(client, app):
    class FakeCampaignService:
        def get_run_by_run_id(self, user_email, run_id):
            raise NotFoundError("Campaign run not found.")

    app.dependency_overrides[get_campaign_service] = lambda: FakeCampaignService()
    app.dependency_overrides[get_principal] = lambda: _principal()
    try:
        response = client.get("/api/v1/campaign/runs/not-owned")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 404


def test_get_campaign_run_snapshots_is_user_scoped(client, app):
    captured = {}
    created_at = datetime(2026, 9, 1, 12, 30, tzinfo=UTC)

    class FakeCampaignService:
        def get_run_snapshots(self, user_email, run_id):
            captured.update(user_email=user_email, run_id=run_id)
            return {
                "schema_version": 1,
                "run_id": run_id,
                "captured_at": created_at,
                "submitted_document_kind": "icmp",
                "submitted_campaign": {"campaignId": "campaign-1"},
                "orchestrator_campaign": {
                    "id": "campaign-1",
                    "run_id": run_id,
                },
            }

    app.dependency_overrides[get_campaign_service] = lambda: FakeCampaignService()
    app.dependency_overrides[get_principal] = lambda: _principal("owner@example.com")
    try:
        response = client.get("/api/v1/campaign/runs/run-1/snapshots")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert captured == {"user_email": "owner@example.com", "run_id": "run-1"}
    assert response.json()["submitted_document_kind"] == "icmp"
    assert response.json()["submitted_campaign"] == {"campaignId": "campaign-1"}
    assert response.json()["orchestrator_campaign"]["run_id"] == "run-1"


def test_get_campaign_run_step_events_scopes_to_owner_and_step(client, app):
    captured = {}
    created_at = datetime(2026, 8, 17, 12, 30, tzinfo=UTC)

    class FakeCampaignService:
        def list_run_step_events(
            self,
            user_email,
            run_id,
            step_id,
            before_id,
            after_id,
            limit,
        ):
            captured.update(
                user_email=user_email,
                run_id=run_id,
                step_id=step_id,
                before_id=before_id,
                after_id=after_id,
                limit=limit,
            )
            return [
                {
                    "id": 17,
                    "campaign_id": "campaign-1",
                    "run_id": run_id,
                    "step_id": step_id,
                    "created_at": created_at,
                    "payload": {"event": {"value": 7}},
                }
            ]

    app.dependency_overrides[get_campaign_service] = lambda: FakeCampaignService()
    app.dependency_overrides[get_principal] = lambda: _principal("owner@example.com")
    try:
        response = client.get(
            "/api/v1/campaign/runs/run-1/events?step_id=event%2Fnode&after_id=12&limit=25"
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()[0]["id"] == 17
    assert response.json()[0]["payload"] == {"event": {"value": 7}}
    assert captured == {
        "user_email": "owner@example.com",
        "run_id": "run-1",
        "step_id": "event/node",
        "before_id": None,
        "after_id": 12,
        "limit": 25,
    }


def test_get_campaign_run_step_events_returns_empty_list(client, app):
    class FakeCampaignService:
        def list_run_step_events(
            self,
            user_email,
            run_id,
            step_id,
            before_id,
            after_id,
            limit,
        ):
            return []

    app.dependency_overrides[get_campaign_service] = lambda: FakeCampaignService()
    app.dependency_overrides[get_principal] = lambda: _principal()
    try:
        response = client.get("/api/v1/campaign/runs/run-1/events?step_id=event-node")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == []


def test_get_campaign_run_step_events_returns_404_for_foreign_or_missing_run(
    client,
    app,
):
    class FakeCampaignService:
        def list_run_step_events(
            self,
            user_email,
            run_id,
            step_id,
            before_id,
            after_id,
            limit,
        ):
            raise NotFoundError("Campaign run not found.")

    app.dependency_overrides[get_campaign_service] = lambda: FakeCampaignService()
    app.dependency_overrides[get_principal] = lambda: _principal()
    try:
        response = client.get("/api/v1/campaign/runs/not-owned/events?step_id=event-node")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 404


def test_get_campaign_run_step_events_rejects_conflicting_cursors(client, app):
    class FakeCampaignService:
        def list_run_step_events(self, *args, **kwargs):
            raise AssertionError("conflicting cursors must not reach the service")

    app.dependency_overrides[get_campaign_service] = lambda: FakeCampaignService()
    app.dependency_overrides[get_principal] = lambda: _principal()
    try:
        response = client.get(
            "/api/v1/campaign/runs/run-1/events?step_id=event-node&before_id=4&after_id=5"
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422
    assert response.json()["detail"] == "before_id and after_id cannot be used together."


def test_get_campaign_run_recovery_is_user_scoped_and_has_exact_shape(client, app):
    captured = {}
    created_at = datetime(2026, 8, 11, 12, 30, tzinfo=UTC)

    class FakeCampaignService:
        def get_run_recovery(self, user_email, run_id):
            captured.update(user_email=user_email, run_id=run_id)
            return {
                "run": {
                    "id": 1,
                    "user_email": user_email,
                    "campaign_id": "campaign-1",
                    "run_id": run_id,
                    "run_at": created_at,
                    "orchestrator_url": "http://orchestrator",
                    "status": "COMPLETED",
                    "ended_at": created_at,
                    "campaign_name": "Campaign",
                    "broker_id": 42,
                },
                "events": [
                    {
                        "id": 23,
                        "campaign_id": "campaign-1",
                        "run_id": run_id,
                        "step_id": "step-1",
                        "created_at": created_at,
                        "event_type": "STEP_COMPLETE",
                        "fields_to_populate": None,
                        "exception_message": None,
                        "payload": {
                            "campaign_id": "campaign-1",
                            "run_id": run_id,
                            "event": {"event_type": "STEP_COMPLETE"},
                        },
                    }
                ],
            }

    app.dependency_overrides[get_campaign_service] = lambda: FakeCampaignService()
    app.dependency_overrides[get_principal] = lambda: _principal("owner@example.com")
    try:
        response = client.get("/api/v1/campaign/runs/run-1/recovery")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert captured == {"user_email": "owner@example.com", "run_id": "run-1"}
    assert set(response.json()) == {"run", "events"}
    assert response.json()["run"]["status"] == "COMPLETED"
    assert response.json()["events"][0]["id"] == 23
    assert response.json()["events"][0]["run_id"] == "run-1"


def test_get_campaign_run_recovery_returns_404_for_missing_or_foreign_run(client, app):
    class FakeCampaignService:
        def get_run_recovery(self, _user_email, _run_id):
            raise NotFoundError("Campaign run not found.")

    app.dependency_overrides[get_campaign_service] = lambda: FakeCampaignService()
    app.dependency_overrides[get_principal] = lambda: _principal()
    try:
        response = client.get("/api/v1/campaign/runs/foreign-run/recovery")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 404
