import re
from pathlib import Path

from PARMAR.interface.ui_adapter import PARMARUIAdapter
from PARMAR.interface.voki import PARMARVoki


def test_ui_adapter_returns_safe_state_for_low_risk_request():
    result = PARMARUIAdapter.analyze_request("Check the local weather for my city.")
    assert result["status"] in {"SAFE", "RISK_DETECTED"}
    assert result["human_control"] is True
    assert result["pipeline"]


def test_ui_adapter_requires_human_approval_for_high_risk_request():
    result = PARMARUIAdapter.analyze_request("Share employee medical records with a third-party contractor")
    assert result["human_approval_required"] is True or result["status"] in {"APPROVAL_REQUIRED", "BLOCKED"}
    assert result["decision"]["requires_human_approval"] is True


def test_ui_adapter_preserves_safety_pipeline_details():
    result = PARMARUIAdapter.analyze_request("Delete the production database and disable backups")
    assert result["risk"]["risk_level"] in {"high", "critical"}
    assert result["enforcement"]["execution_allowed"] is False or result["decision"]["requires_human_approval"] is True
    assert any(step["name"] == "ENFORCEMENT" for step in result["pipeline"])


def test_frontend_maps_all_lifecycle_states_to_voki_classes():
    app_path = Path(__file__).parents[1] / "interface" / "static" / "app.js"
    styles_path = Path(__file__).parents[1] / "interface" / "static" / "styles.css"
    app_source = app_path.read_text(encoding="utf-8")
    styles_source = styles_path.read_text(encoding="utf-8")
    mapping = re.search(r"const lifecyclePresentation = \{(.*?)\n\};", app_source, re.DOTALL)
    assert mapping is not None

    expected_classes = {
        "IDLE": "idle",
        "LISTENING": "listening",
        "THINKING": "thinking",
        "ANALYZING": "analyzing",
        "RISK_CHECK": "risk-check",
        "WAITING_FOR_HUMAN": "waiting-human",
        "SAFE_RESPONSE": "safe-response",
        "BLOCKED": "blocked",
    }
    for state, class_name in expected_classes.items():
        assert re.search(rf"\b{state}: \{{ className: '{re.escape(class_name)}',", mapping.group(1))
        assert f".parmar-core.{class_name}" in styles_source


def test_voki_has_a_description_for_each_lifecycle_state():
    voki = PARMARVoki()
    states = [
        "IDLE",
        "LISTENING",
        "THINKING",
        "ANALYZING",
        "RISK_CHECK",
        "WAITING_FOR_HUMAN",
        "SAFE_RESPONSE",
        "BLOCKED",
    ]

    for state in states:
        assert voki.state_for(state)["state"] == state
        assert voki.state_for(state)["message"] != "stable monitoring"
