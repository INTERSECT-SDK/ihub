from starlette import status


def test_healthcheck_connected(client, app, connected_intersect_client):
    app.state.intersect_client = connected_intersect_client

    response = client.get("/api/v1/healthcheck")

    assert response.status_code == status.HTTP_200_OK
    assert response.json() == {"errors": []}


def test_healthcheck_disconnected(client, app, disconnected_intersect_client):
    app.state.intersect_client = disconnected_intersect_client

    response = client.get("/api/v1/healthcheck")

    assert response.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
    assert response.json() == {"errors": ["not connected"]}


def test_healthcheck_live_ok_when_dependencies_connected(
    client, app, connected_intersect_client
):
    app.state.intersect_client = connected_intersect_client

    response = client.get("/api/v1/healthcheck/live")

    assert response.status_code == status.HTTP_200_OK

def test_healthcheck_live_ok_when_dependencies_disconnected(
    client, app, disconnected_intersect_client
):
    app.state.intersect_client = disconnected_intersect_client

    response = client.get("/api/v1/healthcheck/live")

    assert response.status_code == status.HTTP_200_OK
