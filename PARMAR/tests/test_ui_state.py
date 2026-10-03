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

    for state in (
        "IDLE",
        "LISTENING",
        "THINKING",
        "RESPONDING",
        "APPROVAL_REQUIRED",
        "BLOCKED",
        "REVIEW",
        "ERROR",
        "LOCAL_DEMO",
    ):
        assert re.search(rf"\b{state}: \{{ label:", mapping.group(1))
    for control_id in ("chat-voki", "voki-voice-toggle", "voki-visibility-toggle", "voki-avatar-stage"):
        assert f'id="{control_id}"' in html_source
    assert "Browser speech synthesis is unavailable. Text chat remains available." in app_source
    assert "speechSynthesisAvailable" in app_source
    assert "speechSynthesis.speak(utterance)" in app_source
    assert "speechSynthesis.cancel()" in app_source
    assert re.search(r"utterance\.onstart = \(\) => \{\s*if \(speechToken === state\.vokiSpeechToken\) \{", app_source)
    assert "setChatVokiState('RESPONDING');" in app_source
    assert "setChatVokiState(responseState === 'LOCAL_DEMO' ? 'LOCAL_DEMO' : 'IDLE');" in app_source
    assert "utterance.onend = () => {" in app_source
    assert "utterance.onerror = () => {" in app_source
    assert "getUserMedia" not in app_source
    assert "SpeechRecognition" not in app_source
    for state in ("LISTENING", "THINKING", "RESPONDING", "APPROVAL_REQUIRED", "BLOCKED", "REVIEW", "ERROR", "LOCAL_DEMO"):
        assert f'.chat-voki[data-state="{state}"]' in styles_source
    assert "@media (prefers-reduced-motion: reduce)" in styles_source
    assert "animation-duration: 0.01ms !important" in styles_source
    assert "radial-gradient(circle at 35% 24%" in styles_source
    assert ".chat-voki-orb-center::before" in styles_source
    assert ".chat-voki[data-state=\"THINKING\"] .chat-voki-orb-ring.ring-a" in styles_source
    assert '.chat-voki[data-state="RESPONDING"][data-voice-active="true"] .chat-voki-audio-wave' in styles_source
    assert "@media (max-height: 600px) and (max-width: 640px)" in styles_source
    reduced_motion_blocks = re.findall(
        r"@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}",
        styles_source,
    )
    assert any(".chat-voki-orb-ring" in block for block in reduced_motion_blocks)


def test_browser_does_not_send_memory_as_chat_context():
    app_path = Path(__file__).parents[1] / "interface" / "static" / "app.js"
    app_source = app_path.read_text(encoding="utf-8")
    chat_submit = re.search(r"async function submitChatMessage\(\) \{(.*?)\n\}", app_source, re.DOTALL)
    assert chat_submit is not None
    assert "memory" not in chat_submit.group(1)
    memory_page = (Path(__file__).parents[1] / "interface" / "static" / "index.html").read_text(encoding="utf-8")
    assert "Relevant consented notes may be used as untrusted context in authenticated chat" in memory_page


def test_voki_voice_availability_cancellation_and_memory_opt_in_hooks():
    app_path = Path(__file__).parents[1] / "interface" / "static" / "app.js"
    app_source = app_path.read_text(encoding="utf-8")
    controls = re.search(r"function syncVokiControls\(\) \{(.*?)\n\}", app_source, re.DOTALL)
    cancel = re.search(r"function stopVokiSpeech\(nextState = 'IDLE'\) \{(.*?)\n\}", app_source, re.DOTALL)
    speak = re.search(r"function speakVokiResponse\(text, responseState\) \{(.*?)\n\}", app_source, re.DOTALL)
    assert controls and cancel and speak

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
    chat_submit = re.search(r"async function submitChatMessage\(\) \{(.*?)\n\}", app_source, re.DOTALL)
    assert chat_submit is not None
    assert "memory" not in chat_submit.group(1)
    response_state = re.search(r"function chatVokiResponseState\(result\) \{(.*?)\n\}", app_source, re.DOTALL)
    assert response_state is not None
    assert "result?.provider_error" in response_state.group(1)
    assert "responseStatus.startsWith('PROVIDER_')" in response_state.group(1)
    assert "requestStatus === 'APPROVAL_REQUIRED'" in response_state.group(1)
    assert "['BLOCKED', 'REJECTED'].includes(requestStatus)" in response_state.group(1)
    assert "safetyStatus === 'REVIEW'" in response_state.group(1)
    assert "safetyStatus !== 'PASS'" in response_state.group(1)
    assert "if (vokiResponseState === 'RESPONDING' || vokiResponseState === 'LOCAL_DEMO')" in app_source
    assert "setChatVokiState(vokiResponseState);" in app_source


def test_suppressed_response_text_is_removed_before_chat_history_persistence():
    app_path = Path(__file__).parents[1] / "interface" / "static" / "app.js"
    app_source = app_path.read_text(encoding="utf-8")

    history_sanitizer = re.search(
        r"function sanitizeResponseForHistory\(result\) \{(.*?)\n\}",
        app_source,
        re.DOTALL,
    )
    append_message = re.search(
        r"function appendMessageToSession\(sessionId, role, text, analysis\) \{(.*?)\n\}",
        app_source,
        re.DOTALL,
    )
    chat_submit = re.search(
        r"async function submitChatMessage\(\) \{(.*?)\n\}",
        app_source,
        re.DOTALL,
    )
    assert history_sanitizer and append_message and chat_submit
    assert "suppressCandidateContent(stored)" in history_sanitizer.group(1)
    assert "stored.message = safeChatReply(result)" in history_sanitizer.group(1)
    assert "const reply = safeChatReply(result);" in app_source
    assert "sanitizeResponseForHistory(analysis)" in append_message.group(1)
    assert "const safeText = sanitizeSensitiveText(suppressed ? safeChatReply(analysis) : text);" in append_message.group(1)
    assert "SUPPRESSED_RESPONSE_SAFETY_STATES" in app_source


def test_authenticated_chat_uses_only_server_conversation_ids_and_omits_browser_history():
    app_source = (Path(__file__).parents[1] / "interface" / "static" / "app.js").read_text(encoding="utf-8")
    submit = re.search(r"async function submitChatMessage\(\) \{(.*?)\n\}", app_source, re.DOTALL)
    assert submit is not None
    source = submit.group(1)
    authenticated_branch = re.search(
        r"const context = authenticated\s*\?\s*\{(.*?)\n\s*:\s*\{(.*?)\n\s*\};",
        source,
        re.DOTALL,
    )
    assert authenticated_branch is not None
    assert "recent_messages" not in authenticated_branch.group(1)
    assert "conversation_id: requestedConversationId" in source
    assert "result.conversation_id" in source
    assert "state.serverConversationIds.add(conversationId)" in source
    assert "state.conversationId = conversationId" in source
    assert "state.conversationId !== requestedConversationId" in source
    assert "authEpoch !== state.authEpoch" in source


def test_authenticated_state_never_persists_chat_or_audit_history_to_local_storage():
    app_source = (Path(__file__).parents[1] / "interface" / "static" / "app.js").read_text(encoding="utf-8")
    persistence = re.search(r"function persistedSessionList\(\) \{(.*?)\n\}", app_source, re.DOTALL)
    audit = re.search(r"function addAuditEntry\(request, status, riskLevel, message\) \{(.*?)\n\}", app_source, re.DOTALL)
    assert persistence is not None
    assert audit is not None
    assert "if (state.authMode === 'authenticated')" in persistence.group(1)
    assert "STORAGE_KEYS.localDemoSessions" in persistence.group(1)
    assert "if (state.authMode !== 'authenticated')" in audit.group(1)
    storage_keys = app_source.split("const STORAGE_KEYS", 1)[1].split("};", 1)[0]
    assert "conversationId" not in storage_keys
    assert "csrfToken" not in storage_keys


def test_session_expiry_logout_and_cross_tab_notifications_clear_authenticated_state():
    app_source = (Path(__file__).parents[1] / "interface" / "static" / "app.js").read_text(encoding="utf-8")
    clear = re.search(r"function clearAuthenticatedState\(message, \{ broadcast = false \} = \{\}\) \{(.*?)\n\}", app_source, re.DOTALL)
    refresh = re.search(r"async function refreshAuthenticationState\(\{ expired = false, broadcast = false \} = \{\}\) \{(.*?)\n\}", app_source, re.DOTALL)
    logout = re.search(r"async function logoutAuthenticatedSession\(\) \{(.*?)\n\}", app_source, re.DOTALL)
    cross_tab = re.search(r"function configureCrossTabAuthentication\(\) \{(.*?)\n\}", app_source, re.DOTALL)
    assert clear and refresh and logout and cross_tab
    assert "state.pendingApprovalId = null" in clear.group(1)
    assert "state.conversationId = null" in clear.group(1)
    assert "state.localDemoSessions = loadSessions()" in clear.group(1)
    assert "fetch('/api/session'" in refresh.group(1)
    assert "payload?.authenticated === true" in refresh.group(1)
    assert "apiRequest('/api/logout'" in logout.group(1)
    assert "broadcast: true" in logout.group(1)
    assert "refreshAuthenticationState({ expired: true })" in cross_tab.group(1)
    assert "authentication-ended" in cross_tab.group(1)


def test_authenticated_posts_use_csrf_and_server_history_is_not_faked_in_sidebar():
    app_source = (Path(__file__).parents[1] / "interface" / "static" / "app.js").read_text(encoding="utf-8")
    api_request = re.search(r"function apiRequest\(path, options = \{\}\) \{(.*?)\n\}", app_source, re.DOTALL)
    assert api_request is not None
    assert "state.csrfToken" in api_request.group(1)
    assert "headers['X-CSRF-Token']" in api_request.group(1)
    assert "authenticated" in api_request.group(1)
    assert "[401, 403, 404].includes(response.status)" in api_request.group(1)
    assert "Server conversation history is not available in this view yet." in app_source


def test_authenticated_logout_control_is_hidden_until_server_confirms_session():
    html_source = (Path(__file__).parents[1] / "interface" / "static" / "index.html").read_text(encoding="utf-8")
    app_source = (Path(__file__).parents[1] / "interface" / "static" / "app.js").read_text(encoding="utf-8")
    assert 'id="logout-btn"' in html_source
    assert 'id="logout-btn" type="button" hidden' in html_source
    assert "if (dom.logoutBtn) dom.logoutBtn.hidden = false;" in app_source
    assert "if (dom.logoutBtn) dom.logoutBtn.hidden = true;" in app_source


def test_authenticated_memory_uses_server_crud_and_never_browser_memory_storage():
    app_source = (Path(__file__).parents[1] / "interface" / "static" / "app.js").read_text(encoding="utf-8")
    memory_load = re.search(r"async function refreshAuthenticatedMemories\(\) \{(.*?)\n\}", app_source, re.DOTALL)
    consent = re.search(r"async function setAuthenticatedMemoryConsent\(granted\) \{(.*?)\n\}", app_source, re.DOTALL)
    save = re.search(r"async function addMemory\(event\) \{(.*?)\n\}", app_source, re.DOTALL)
    update = re.search(r"async function editMemory\(memoryId\) \{(.*?)\n\}", app_source, re.DOTALL)
    delete = re.search(r"async function deleteMemory\(memoryId\) \{(.*?)\n\}", app_source, re.DOTALL)
    persist = re.search(r"function persistMemories\(memories\) \{(.*?)\n\}", app_source, re.DOTALL)
    assert memory_load and consent and save and update and delete and persist
    assert "apiRequest('/api/memory'" in memory_load.group(1)
    assert "{ action: 'consent', granted }" in consent.group(1)
    assert "action: 'save'" in save.group(1)
    assert "state.memoryConsent" in save.group(1)
    assert "action: 'update'" in update.group(1)
    assert "action: 'delete'" in delete.group(1)
    assert "state.authMode !== 'anonymous'" in persist.group(1)
    assert "persistMemories(nextMemories)" in save.group(1)
    storage_keys = app_source.split("const STORAGE_KEYS", 1)[1].split("};", 1)[0]
    assert "memories: 'parmar-memories-v1'" in storage_keys


def test_authenticated_chat_does_not_read_or_send_browser_memory_context():
    app_source = (Path(__file__).parents[1] / "interface" / "static" / "app.js").read_text(encoding="utf-8")
    chat = re.search(r"async function submitChatMessage\(\) \{(.*?)\n\}", app_source, re.DOTALL)
    assert chat is not None
    assert "memory" not in chat.group(1)
    assert "context: memory" not in chat.group(1)


def test_research_workspace_is_conversation_linked_and_does_not_claim_live_search():
    static_dir = Path(__file__).parents[1] / "interface" / "static"
    html_source = (static_dir / "index.html").read_text(encoding="utf-8")
    styles_source = (static_dir / "styles.css").read_text(encoding="utf-8")
    app_source = (static_dir / "app.js").read_text(encoding="utf-8")

    assert 'data-action="research"' in html_source
    assert 'id="research-workspace"' in html_source
    assert 'data-research-state="disconnected"' in html_source
    assert "Linked to the current conversation" in html_source
    assert 'id="research-query-input" type="search"' in html_source
    assert 'id="research-query-input" type="search" placeholder="Search is not connected" disabled' in html_source
    assert 'id="research-progress-title"' in html_source
    assert 'data-state="empty"' in html_source
    assert 'data-state="not-available"' in html_source
    for source_field in (
        "research-source-type",
        "research-source-domain",
        "research-source-title",
        "research-source-preview",
        "research-source-citation",
        "research-source-select",
        "research-source-open",
    ):
        assert source_field in html_source
    assert "No current headlines are shown." in html_source
    assert "body.research-open .research-workspace" in styles_source
    assert "data-research-state=\"searching\"" in styles_source
    assert "setResearchOpen(true)" in app_source


def test_memory_page_explains_consent_and_controlled_chat_context():
    html_source = (Path(__file__).parents[1] / "interface" / "static" / "index.html").read_text(encoding="utf-8")
    assert 'id="memory-storage-title"' in html_source
    assert "authenticated notes are stored on the server only after explicit consent" in html_source.casefold()
    assert "Relevant consented notes may be used as untrusted context in authenticated chat" in html_source
    assert "if an external provider is selected and authorized, matched notes may be included in its request" in html_source


def test_memory_ui_discloses_external_provider_context_conditionally():
    app_source = (Path(__file__).parents[1] / "interface" / "static" / "app.js").read_text(encoding="utf-8")
    render = re.search(r"function renderMemories\(\) \{(.*?)\n\}", app_source, re.DOTALL)
    assert render is not None
    assert "state.settings.provider !== 'local-demo'" in render.group(1)
    assert "if it is authorized for this request, matched notes may be included in its request" in render.group(1)
    assert "selected provider is local demo; notes are not sent to an external provider" in render.group(1)
