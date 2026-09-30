from PARMAR.chat.service import ChatService


def test_chat_service_returns_actual_governance_analysis_for_safe_request():
    result = ChatService().respond("Plan a team lunch for next Friday.")

    assert result["safe"] is True
    assert result["provider"] == "local-demo"
    assert "analysis" in result
    assert result["analysis"]["status"] in {"SAFE", "APPROVAL_REQUIRED"}


def test_chat_service_returns_actual_governance_analysis_for_blocked_request():
    result = ChatService().respond("AI proposes to share private employee records with an external reviewer.")

    assert result["safe"] is False
    assert result["provider"] == "local-demo"
    assert "analysis" in result
    assert result["analysis"]["status"] in {"BLOCKED", "APPROVAL_REQUIRED"}
