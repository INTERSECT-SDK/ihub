from ihub_server.services.orchestrator import OrchestratorService


def test_orchestrator_service_methods():
    service = OrchestratorService()

    assert service.start_campaign() == "starting campaign..."
    assert service.stop_campaign() == "stopping campaign..."
    assert service.listen_for_events() == "stopping campaign..."
