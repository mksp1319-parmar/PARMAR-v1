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


def test_chat_voki_has_response_states_voice_and_minimize_controls():
    static_dir = Path(__file__).parents[1] / "interface" / "static"
    app_source = (static_dir / "app.js").read_text(encoding="utf-8")
    html_source = (static_dir / "index.html").read_text(encoding="utf-8")
    styles_source = (static_dir / "styles.css").read_text(encoding="utf-8")
    mapping = re.search(r"const vokiChatPresentation = \{(.*?)\n\};", app_source, re.DOTALL)
    assert mapping is not None

    for state in ("IDLE", "LISTENING", "THINKING", "SPEAKING", "PAUSED", "ERROR"):
        assert re.search(rf"\b{state}: \{{ label:", mapping.group(1))
    for control_id in ("chat-voki", "voki-voice-toggle", "voki-visibility-toggle", "voki-avatar-stage"):
        assert f'id="{control_id}"' in html_source
    assert "Browser speech synthesis is unavailable. Text chat remains available." in app_source
    assert "speechSynthesisAvailable" in app_source
    assert "speechSynthesis.speak(utterance)" in app_source
    assert "speechSynthesis.cancel()" in app_source
    assert re.search(r"utterance\.onstart = \(\) => \{\s*if \(speechToken === state\.vokiSpeechToken\) setChatVokiState\('SPEAKING'\);", app_source)
    assert "utterance.onend = () => {" in app_source
    assert "utterance.onerror = () => {" in app_source
    assert "getUserMedia" not in app_source
    assert "SpeechRecognition" not in app_source
    for state in ("LISTENING", "THINKING", "SPEAKING", "PAUSED", "ERROR"):
        assert f'.chat-voki[data-state="{state}"]' in styles_source
    assert "@media (prefers-reduced-motion: reduce)" in styles_source
    assert "animation-duration: 0.01ms !important" in styles_source


def test_disabled_memory_is_omitted_from_chat_context():
    app_path = Path(__file__).parents[1] / "interface" / "static" / "app.js"
    app_source = app_path.read_text(encoding="utf-8")
    assert re.search(r"memoryEnabled: false", app_source)
    context_helper = re.search(r"function activeMemoryContext\(\) \{(.*?)\n\}", app_source, re.DOTALL)
    assert context_helper is not None
    assert "if (!state.settings.memoryEnabled) return [];" in context_helper.group(1)
    assert "return state.memories.map((memory) => memory.text);" in context_helper.group(1)
    memory_page = (Path(__file__).parents[1] / "interface" / "static" / "index.html").read_text(encoding="utf-8")
    assert "ChatContext.memory" in memory_page
    assert "local demo receives this context but ignores it" in memory_page


def test_voki_voice_availability_cancellation_and_memory_opt_in_hooks():
    app_path = Path(__file__).parents[1] / "interface" / "static" / "app.js"
    app_source = app_path.read_text(encoding="utf-8")
    controls = re.search(r"function syncVokiControls\(\) \{(.*?)\n\}", app_source, re.DOTALL)
    cancel = re.search(r"function stopVokiSpeech\(nextState = 'IDLE'\) \{(.*?)\n\}", app_source, re.DOTALL)
    speak = re.search(r"function speakVokiResponse\(text\) \{(.*?)\n\}", app_source, re.DOTALL)
    memory_context = re.search(r"function activeMemoryContext\(\) \{(.*?)\n\}", app_source, re.DOTALL)
    assert controls and cancel and speak and memory_context

    assert "disabled = !available" in controls.group(1)
    assert "Browser speech synthesis is unavailable." in controls.group(1)
    assert "state.vokiSpeechToken += 1" in cancel.group(1)
    assert "window.speechSynthesis.cancel()" in cancel.group(1)
    assert "setChatVokiState(nextState)" in cancel.group(1)
    assert "utterance.onstart" in speak.group(1)
    assert "utterance.onend" in speak.group(1)
    assert "utterance.onerror" in speak.group(1)
    assert "vokiVoiceEnabled: stored?.vokiVoiceEnabled === true" in app_source
    assert "if (!state.settings.vokiVoiceEnabled) stopVokiSpeech('IDLE');" in app_source
    assert "...(memory.length ? { memory } : {})" in app_source
    assert "if (!state.settings.memoryEnabled) return [];" in memory_context.group(1)
    response_state = re.search(r"function chatVokiResponseState\(result\) \{(.*?)\n\}", app_source, re.DOTALL)
    assert response_state is not None
    assert "result?.provider_error" in response_state.group(1)
    assert "responseStatus.startsWith('PROVIDER_')" in response_state.group(1)
    assert "'BLOCKED', 'APPROVAL_REQUIRED', 'REJECTED', 'WAITING_FOR_HUMAN'" in response_state.group(1)
    assert "if (vokiResponseState) setChatVokiState(vokiResponseState);" in app_source
    assert "else speakVokiResponse(reply);" in app_source
