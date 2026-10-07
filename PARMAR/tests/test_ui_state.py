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


def test_frontend_maps_all_lifecycle_states_to_voki_identity():
    app_path = Path(__file__).parents[1] / "interface" / "static" / "app.js"
    styles_path = Path(__file__).parents[1] / "interface" / "static" / "styles.css"
    avatar_path = Path(__file__).parents[1] / "interface" / "static" / "voki-avatar.js"
    app_source = app_path.read_text(encoding="utf-8")
    styles_source = styles_path.read_text(encoding="utf-8")
    avatar_source = avatar_path.read_text(encoding="utf-8")
    mapping = re.search(r"const lifecyclePresentation = \{(.*?)\n\};", app_source, re.DOTALL)
    assert mapping is not None

    expected_classes = {
        "IDLE": "idle",
        "LISTENING": "listening",
        "THINKING": "thinking",
        "ANALYZING": "analyzing",
        "RISK_CHECK": "risk-check",
        "WAITING_FOR_HUMAN": "waiting-human",
        "ENFORCEMENT_ALLOWED": "thinking",
        "PROVIDER": "thinking",
        "RESPONSE_SAFETY": "risk-check",
        "RELEASED": "safe-response",
        "WITHHELD": "waiting-human",
        "PROVIDER_FAILED": "blocked",
        "BLOCKED": "blocked",
    }
    for state, class_name in expected_classes.items():
        assert re.search(rf"\b{state}: \{{ className: '{re.escape(class_name)}',", mapping.group(1))
        assert re.search(rf"\b{state}: '[a-z-]+',", avatar_source)
    assert "state.homeVokiAvatar?.setLifecycle" in app_source
    assert '.home-voki-presence[data-lifecycle-state="WAITING_FOR_HUMAN"]' in styles_source


def test_voki_has_a_description_for_each_lifecycle_state():
    voki = PARMARVoki()
    states = [
        "IDLE",
        "LISTENING",
        "THINKING",
        "ANALYZING",
        "RISK_CHECK",
        "WAITING_FOR_HUMAN",
        "ENFORCEMENT_ALLOWED",
        "PROVIDER",
        "RESPONSE_SAFETY",
        "RELEASED",
        "WITHHELD",
        "PROVIDER_FAILED",
        "BLOCKED",
    ]

    for state in states:
        assert voki.state_for(state)["state"] == state
        assert voki.state_for(state)["message"] != "stable monitoring"
    assert voki.state_for("SAFE_RESPONSE")["state"] == "UNKNOWN"
    assert "no authoritative state is asserted" in voki.state_for("SAFE_RESPONSE")["message"]


def test_chat_and_voki_are_separate_workspaces_with_dedicated_voki_controls():
    static_dir = Path(__file__).parents[1] / "interface" / "static"
    app_source = (static_dir / "app.js").read_text(encoding="utf-8")
    html_source = (static_dir / "index.html").read_text(encoding="utf-8")
    chat_section = re.search(r'<section class="section-view" data-section="chat".*?</section>\s*</section>', html_source, re.DOTALL)
    assert chat_section is not None
    assert 'id="section-voki"' in html_source
    assert 'data-voki-interface' in html_source
    assert 'data-voki-speech-toggle' in html_source
    assert 'data-voki-stop-speech' in html_source
    assert 'data-section="voki"' in chat_section.group(0)
    assert "Open VOKKI" in chat_section.group(0)
    for legacy_control in ("chat-voki", "voki-voice-toggle", "voki-visibility-toggle", "voki-avatar-stage"):
        assert legacy_control not in chat_section.group(0)
    assert "function setChatVokiState" not in app_source
    assert "speechSynthesis.speak(utterance)" not in app_source
    assert "/static/voki-interface.js" in html_source
    assert html_source.index('/static/chat-presentation.js') < html_source.index('/static/app.js')


def test_browser_does_not_send_memory_as_chat_context():
    app_path = Path(__file__).parents[1] / "interface" / "static" / "app.js"
    app_source = app_path.read_text(encoding="utf-8")
    chat_submit = re.search(r"async function submitChatMessage\(\) \{(.*?)\n\}", app_source, re.DOTALL)
    assert chat_submit is not None
    assert "memory" not in chat_submit.group(1)
    memory_page = (Path(__file__).parents[1] / "interface" / "static" / "index.html").read_text(encoding="utf-8")
    assert "Relevant consented notes may be used only as untrusted context in authenticated Chat/VOKKI" in memory_page


def test_voki_speech_is_owned_by_the_dedicated_voki_interface():
    app_path = Path(__file__).parents[1] / "interface" / "static" / "app.js"
    voki_path = Path(__file__).parents[1] / "interface" / "static" / "voki-interface.js"
    app_source = app_path.read_text(encoding="utf-8")
    voki_source = voki_path.read_text(encoding="utf-8")
    assert "speechSynthesis.speak(utterance)" not in app_source
    assert "this.speech?.setEnabled(this.speechToggle.checked)" in voki_source
    assert "this.speech?.cancel()" in voki_source
    assert "speechSynthesis" not in app_source


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
    assert "sanitizeSensitiveText(suppressed || unconfirmedCandidate ? safeChatReply(analysis) : text)" in append_message.group(1)
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
    audit = re.search(r"function addAuditEntry\([^)]*\) \{(.*?)\n\}", app_source, re.DOTALL)
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
    clear = re.search(r"function clearAuthenticatedState\([^)]*\) \{(.*?)\n\}", app_source, re.DOTALL)
    refresh = re.search(r"async function refreshAuthenticationState\([^)]*\) \{(.*?)\n\}", app_source, re.DOTALL)
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
    assert "No conversations yet." in app_source
    assert re.search(r"async function refreshServerConversationHistory\([^)]*\)", app_source)
    assert re.search(r"async function selectServerConversation\([^)]*\)", app_source)
    assert "apiRequest('/api/conversations'" in app_source
    assert "apiRequest(`/api/conversations/${encodeURIComponent(conversationId)}`" in app_source


def test_voki_and_chat_share_server_selected_conversation_without_history_replay():
    app_path = Path(__file__).parents[1] / "interface" / "static" / "app.js"
    html_path = Path(__file__).parents[1] / "interface" / "static" / "index.html"
    voki_path = Path(__file__).parents[1] / "interface" / "static" / "voki-interface.js"
    app_source = app_path.read_text(encoding="utf-8")
    html_source = html_path.read_text(encoding="utf-8")
    voki_source = voki_path.read_text(encoding="utf-8")
    new_chat = re.search(
        r"dom\.newSessionBtn\.addEventListener\('click', \(\) => \{(.*?)\n\s*\}\);",
        app_source,
        re.DOTALL,
    )
    restore = re.search(
        r"async function refreshServerConversationHistory\([^)]*\) \{(.*?)\n\}",
        app_source,
        re.DOTALL,
    )
    select = re.search(
        r"async function selectServerConversation\([^)]*\) \{(.*?)\n\}",
        app_source,
        re.DOTALL,
    )
    assert new_chat and restore and select
    assert 'data-voki-home-avatar' in html_source
    assert 'data-voki-default-image src="/static/assets/voki/default-avatar.png"' in html_source
    assert 'data-section="voki"' in html_source
    assert 'aria-label="VOKKI interface"' in html_source
    assert "button.dataset.section === 'voki'" in app_source
    assert "dom.vokiInput?.focus({ preventScroll: true })" in app_source
    assert "ACTIVE_CONVERSATION_KEY = 'parmar-active-conversation-v1'" in app_source
    assert "await selectServerConversation(restoreConversationId, { navigateToChat })" in restore.group(1)
    assert "publishConversationSelection(conversationId, true)" in select.group(1)
    assert "publishConversationSelection(session?.id ?? null)" in new_chat.group(1)
    assert "parmar-voki-conversation-activated" in app_source
    assert "parmar-conversation-selection-changed" in voki_source
    assert "persisted_release: true" in voki_source
    assert "this.speech?.speakReleasedResponse" not in voki_source.split("async loadConversation", 1)[1].split("renderHistory", 1)[0]
    lifecycle_setter = re.search(r"function setVokiState\(rawState\) \{(.*?)\n\}", app_source, re.DOTALL)
    assert lifecycle_setter
    assert "setTimeout" not in lifecycle_setter.group(1)


def test_authenticated_logout_control_is_hidden_until_server_confirms_session():
    html_source = (Path(__file__).parents[1] / "interface" / "static" / "index.html").read_text(encoding="utf-8")
    app_source = (Path(__file__).parents[1] / "interface" / "static" / "app.js").read_text(encoding="utf-8")
    render_auth = re.search(r"function renderAuthenticationControls\(\) \{(.*?)\n\}", app_source, re.DOTALL)
    assert 'id="logout-btn"' in html_source
    assert 'id="logout-btn" type="button" hidden' in html_source
    assert render_auth is not None
    assert "dom.logoutBtn.hidden = !authenticated" in render_auth.group(1)
    assert "renderAuthenticationControls();" in app_source


def test_authenticated_memory_uses_server_crud_and_never_browser_memory_storage():
    app_source = (Path(__file__).parents[1] / "interface" / "static" / "app.js").read_text(encoding="utf-8")
    memory_load = re.search(r"async function refreshAuthenticatedMemories\(\) \{(.*?)\n\}", app_source, re.DOTALL)
    consent = re.search(r"async function setAuthenticatedMemoryConsent\(granted\) \{(.*?)\n\}", app_source, re.DOTALL)
    save = re.search(r"async function addMemory\(event\) \{(.*?)\n\}", app_source, re.DOTALL)
    update = re.search(r"async function editMemory\(memoryId\) \{(.*?)\n\}", app_source, re.DOTALL)
    delete = re.search(r"async function deleteMemory\(memoryId\) \{(.*?)\n\}", app_source, re.DOTALL)
    clear_all = re.search(r"async function clearAllMemories\(\) \{(.*?)\n\}", app_source, re.DOTALL)
    persist = re.search(r"function persistMemories\(memories\) \{(.*?)\n\}", app_source, re.DOTALL)
    assert memory_load and consent and save and update and delete and clear_all and persist
    assert "apiRequest('/api/memory'" in memory_load.group(1)
    assert "{ action: 'consent', granted }" in consent.group(1)
    assert "action: 'save'" in save.group(1)
    assert "state.memoryConsent" in save.group(1)
    assert "action: 'update'" in update.group(1)
    assert "action: 'delete'" in delete.group(1)
    assert "action: 'clear_all'" in clear_all.group(1)
    assert "for (const memory of [...state.memories])" not in clear_all.group(1)
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


def test_memory_page_explains_consent_and_controlled_chat_context():
    html_source = (Path(__file__).parents[1] / "interface" / "static" / "index.html").read_text(encoding="utf-8")
    assert 'id="memory-storage-title"' in html_source
    assert "authenticated notes are stored durably on this server’s local disk" in html_source.casefold()
    assert "not encrypted at rest" in html_source
    assert "Relevant consented notes may be used only as untrusted context in authenticated Chat/VOKKI" in html_source
    assert "if an external provider is selected and authorized, matched notes may be included in its request" in html_source


def test_memory_ui_discloses_external_provider_context_conditionally():
    app_source = (Path(__file__).parents[1] / "interface" / "static" / "app.js").read_text(encoding="utf-8")
    render = re.search(r"function renderMemories\(\) \{(.*?)\n\}", app_source, re.DOTALL)
    assert render is not None
    assert "state.settings.provider !== 'local-demo'" in render.group(1)
    assert "if it is authorized for this request, matched notes may be included in its request" in render.group(1)
    assert "selected provider is local demo; notes are not sent to an external provider" in render.group(1)


def test_workspace_toolbar_routes_real_research_through_chat_without_a_fake_workspace():
    static_dir = Path(__file__).parents[1] / "interface" / "static"
    html_source = (static_dir / "index.html").read_text(encoding="utf-8")
    app_source = (static_dir / "app.js").read_text(encoding="utf-8")

    for control_id in ("sidebar", "sidebar-close", "sidebar-toggle", "discovery-panel", "discovery-toggle", "discovery-close", "panel-scrim"):
        assert f'id="{control_id}"' in html_source
    assert 'role="toolbar" aria-label="PARMAR capabilities"' in html_source
    assert 'data-action="new-chat" aria-label="New Chat" title="New Chat"' in html_source
    assert '<svg viewBox="0 0 24 24" aria-hidden="true">' in html_source
    assert 'data-section="memory"' in html_source
    assert 'data-section="tools"' in html_source
    assert 'data-section="voki" title="Open the dedicated VOKKI interface"' in html_source
    assert '<span>Plugins</span><span class="capability-unavailable">Not connected</span>' in html_source
    assert '<span>Tools</span><span class="capability-unavailable">Not connected</span>' in html_source
    for capability in ("Automation and reminders", "Developer and GitHub", "Connected accounts", "Knowledge and documents", "Multimodal input", "Local demo"):
        assert capability in html_source
    assert 'disabled aria-describedby="files-unavailable"' in html_source
    assert 'id="research-mode" type="checkbox"' in html_source
    assert 'data-action="research-chat"' in html_source
    assert "Open Chat with Research enabled" in html_source
    assert "Enable Research in Chat" in html_source
    assert "Research uses the configured search provider when available." in html_source
    assert "Research workflow" not in html_source
    assert "Ready for evidence" not in html_source
    assert "discovery-source-list" not in html_source
    assert "discovery-evidence-list" not in html_source
    assert "research_client_error" in app_source
    assert "researchRequestOption(researchRequested)" in app_source
    assert "Research request in progress… Waiting for PARMAR’s response. This is transport status only." in app_source
    assert "metadata-only" in html_source
    assert 'id="section-voki"' in html_source
    assert 'data-section="voki" title="Open the dedicated VOKKI interface"' in html_source
    styles_source = (static_dir / "styles.css").read_text(encoding="utf-8")
    assert 'body[data-theme="aurora"]' in styles_source
    assert 'body[data-theme="violet"]' in styles_source
    assert "--ambient-silver" in styles_source
    assert "--ambient-warm" in styles_source
    home_styles = re.search(r"\.home-hero \{(.*?)\n\.home-section \{", styles_source, re.DOTALL)
    assert home_styles is not None
    assert "--ambient-blue" not in home_styles.group(1)
    assert "--ambient-cyan" not in home_styles.group(1)
    assert ".capability-menu {\n  position: fixed;" in styles_source
    assert "fetch('/api/search'" not in app_source
    assert "fetch('/api/research'" not in app_source
    assert "fetch('/api/news'" not in app_source


def test_research_mode_is_an_explicit_chat_option_and_resets_for_new_chat():
    app_source = (Path(__file__).parents[1] / "interface" / "static" / "app.js").read_text(encoding="utf-8")
    submit = re.search(r"async function submitChatMessage\(\) \{(.*?)\n\}", app_source, re.DOTALL)
    assert submit is not None
    source = submit.group(1)
    assert "const researchRequested = Boolean(dom.researchMode?.checked);" in source
    assert "...window.PARMARChatPresentation.researchRequestOption(researchRequested)" in source
    assert "const requestId = beginRequest();" in source
    assert "if (requestId === null) return;" in source

    new_chat = re.search(
        r"if \(dom\.newSessionBtn\) \{\s*dom\.newSessionBtn\.addEventListener\('click', \(\) => \{(.*?)\n\s*\}\);",
        app_source,
        re.DOTALL,
    )
    assert new_chat is not None
    assert "if (dom.researchMode) dom.researchMode.checked = false;" in new_chat.group(1)


def test_drawer_state_is_accessible_and_independent_from_voki_lifecycle():
    app_path = Path(__file__).parents[1] / "interface" / "static" / "app.js"
    app_source = app_path.read_text(encoding="utf-8")
    styles_source = (Path(__file__).parents[1] / "interface" / "static" / "styles.css").read_text(encoding="utf-8")
    accessibility = re.search(r"function syncWorkspaceAccessibility\(.*?\n\}", app_source, re.DOTALL)
    opening = re.search(r"function openWorkspacePanel\(.*?\n\}", app_source, re.DOTALL)
    closing = re.search(r"function closeWorkspacePanel\(.*?\n\}", app_source, re.DOTALL)
    assert accessibility and opening and closing

    assert "panel.inert = !visible" in accessibility.group(0)
    assert "setAttribute('aria-hidden'" in accessibility.group(0)
    assert "setAttribute('aria-modal', 'true')" in accessibility.group(0)
    assert "setAttribute('aria-expanded'" in accessibility.group(0)
    assert "closeButton?.focus" in opening.group(0)
    assert "focusOrigin?.focus" in app_source
    assert "applyWorkspacePanelState(otherSide, 'closed'" in opening.group(0)
    assert "Escape" in app_source and "trapWorkspacePanelFocus" in app_source
    assert "setVokiState" not in opening.group(0) + closing.group(0)
    assert "setChatVokiState" not in opening.group(0) + closing.group(0)
    assert "prefers-reduced-motion: reduce" in styles_source
    for panel_state in ("closed", "opening", "open", "closing"):
        assert f"'{panel_state}'" in app_source
    assert "dom.sidebarClose?.addEventListener('click'" in app_source
    assert "dom.discoveryClose?.addEventListener('click'" in app_source
    assert "dom.panelScrim?.addEventListener('click'" in app_source


def test_edge_gestures_protect_scroll_selection_composer_and_voki():
    app_path = Path(__file__).parents[1] / "interface" / "static" / "app.js"
    app_source = app_path.read_text(encoding="utf-8")
    excluded = re.search(r"function panelGestureExcluded\(target\) \{(.*?)\n\}", app_source, re.DOTALL)
    move = re.search(r"function movePanelGesture\(event\) \{(.*?)\n\}", app_source, re.DOTALL)
    start = re.search(r"function startPanelGesture\(event\) \{(.*?)\n\}", app_source, re.DOTALL)
    assert excluded and move and start

    for target in (".chat-composer", ".chat-thread", "button", "[contenteditable=\"true\"]"):
        assert target in excluded.group(1)
    assert "window.getSelection" in start.group(1)
    assert "window.getSelection" in move.group(1)
    assert "panelGestureAxis(deltaX, deltaY)" in move.group(1)
    assert "event.preventDefault()" in move.group(1)
    assert "PANEL_EDGE_ZONE = 24" in app_source


def test_chat_history_entrance_motion_only_applies_to_explicitly_new_messages():
    static_dir = Path(__file__).parents[1] / "interface" / "static"
    app_source = (static_dir / "app.js").read_text(encoding="utf-8")
    styles_source = (static_dir / "styles.css").read_text(encoding="utf-8")
    renderer = re.search(r"function renderSessionMessages\(animateLatest = false, revealLatestAssistant = false\) \{(.*?)\n\}", app_source, re.DOTALL)
    assert renderer is not None
    assert "if (animateLatest && index === session.messages.length - 1) wrapper.classList.add('message-entering')" in renderer.group(1)
    assert "revealLatestAssistant" in renderer.group(1)
    assert "window.PARMARChatPresentation?.isAuthoritativelyReleased(message.analysis)" in renderer.group(1)
    waiting = re.search(r"function appendWaitingIndicator\(researchRequested = false\) \{(.*?)\n\}", app_source, re.DOTALL)
    assert waiting is not None
    assert "Waiting for PARMAR…" in waiting.group(1)
    assert "thinking" not in waiting.group(1).casefold()
    assert "backend" not in waiting.group(1).casefold()
    assert ".message,\n.message .message-bubble {\n  animation: none;\n}" in styles_source
    assert ".message.message-entering {\n  animation: message-arrive 220ms ease both;\n}" in styles_source


def test_chat_release_guard_copy_and_reveal_cancellation_are_integrated():
    static_dir = Path(__file__).parents[1] / "interface" / "static"
    app_source = (static_dir / "app.js").read_text(encoding="utf-8")
    presentation_source = (static_dir / "chat-presentation.js").read_text(encoding="utf-8")
    render = re.search(
        r"function renderSessionMessages\(animateLatest = false, revealLatestAssistant = false\) \{(.*?)\n\}",
        app_source,
        re.DOTALL,
    )
    cancel = re.search(r"function cancelChatResponseReveal\(\) \{(.*?)\n\}", app_source, re.DOTALL)
    submit = re.search(r"async function submitChatMessage\(\) \{(.*?)\n\}", app_source, re.DOTALL)
    append = re.search(r"function appendMessageToSession\(sessionId, role, text, analysis\) \{(.*?)\n\}", app_source, re.DOTALL)
    new_chat = re.search(r"if \(dom\.newSessionBtn\) \{(.*?)\n\s*\}", app_source, re.DOTALL)
    continue_conversation = re.search(r"function continueConversation\([^)]*\) \{(.*?)\n\}", app_source, re.DOTALL)
    server_conversation = re.search(r"async function selectServerConversation\([^)]*\) \{(.*?)\n\}", app_source, re.DOTALL)
    assert render and cancel and submit and append and new_chat and continue_conversation and server_conversation

    for contract_field in (
        "contract?.lifecycle?.state === 'RELEASED'",
        "contract?.provider?.status === 'COMPLETED'",
        "contract?.response_safety?.status === 'PASS'",
        "contract?.response_disposition === 'RELEASED'",
    ):
        assert contract_field in presentation_source
    assert "if (!window.PARMARChatPresentation?.isAuthoritativelyReleased(result))" in app_source
    assert "responseSafetyMessage(status)" in app_source
    assert "window.PARMARChatPresentation.startProgressiveReveal" in render.group(1)
    assert "reducedMotion: motionIsReduced()" in render.group(1)
    assert "accessibleText.className = 'sr-only'" in render.group(1)
    assert "startProgressiveReveal" in presentation_source
    assert "createCopyButton(String(message.text ?? ''))" in render.group(1)
    assert "state.chatRevealCancel?.()" in cancel.group(1)
    assert "cancelChatResponseReveal();" in render.group(1)
    assert "renderSessionMessages();" in new_chat.group(1)
    assert "invalidatePendingRequest();" in new_chat.group(1)
    assert "renderSessionMessages();" in continue_conversation.group(1)
    assert "renderSessionMessages();" in server_conversation.group(1)
    assert "role === 'assistant' && isUnconfirmedCandidateResponse(analysis)" in append.group(1)


def test_chat_composer_keyboard_and_duplicate_request_guards_remain():
    app_source = (Path(__file__).parents[1] / "interface" / "static" / "app.js").read_text(encoding="utf-8")
    events = re.search(r"if \(dom\.chatSubmit\) \{(.*?)\n\s*if \(dom\.memoryEnabledToggle\)", app_source, re.DOTALL)
    request = re.search(r"function beginRequest\(\) \{(.*?)\n\}", app_source, re.DOTALL)
    submit = re.search(r"async function submitChatMessage\(\) \{(.*?)\n\}", app_source, re.DOTALL)
    assert events and request and submit
    assert "event.key === 'Enter' && !event.shiftKey && !event.isComposing" in events.group(1)
    assert "event.preventDefault()" in events.group(1)
    assert "dom.chatInput.addEventListener('input', resizeChatInput)" in events.group(1)
    assert "state.requestInFlight" in request.group(1)
    assert "if (requestId === null) return;" in submit.group(1)


def test_vokki_identity_uses_real_lifecycle_and_not_a_speaking_orb_for_local_demo():
    static_dir = Path(__file__).parents[1] / "interface" / "static"
    html_source = (static_dir / "index.html").read_text(encoding="utf-8")
    app_source = (static_dir / "app.js").read_text(encoding="utf-8")
    styles_source = (static_dir / "styles.css").read_text(encoding="utf-8")
    avatar_source = (static_dir / "voki-avatar.js").read_text(encoding="utf-8")
    lifecycle_mapping = re.search(r"function setVokiState\(rawState\) \{(.*?)\n\}", app_source, re.DOTALL)
    assert lifecycle_mapping

    assert "PARMAR / COMMAND CENTER" in html_source
    assert "data-voki-home-avatar" in html_source
    assert "data-voki-default-image src=\"/static/assets/voki/default-avatar.png\"" in html_source
    assert "state.homeVokiAvatar?.setLifecycle" in app_source
    assert "DEFAULT_VOKKI_IDENTITY" in avatar_source
    assert 'id="section-chat"' in html_source
    assert 'id="section-voki"' in html_source
    assert 'id="section-core"' in html_source
    assert 'data-voki-interface' in html_source
    assert "setChatVokiState" not in app_source
    assert 'data-voki-speech-toggle' in html_source
    assert '.voki-presence[data-speech-state="SPEAKING"]' in styles_source
    assert '.voki-avatar[data-expression="approval-required"] .voki-avatar-default-image' in styles_source
    assert "key === 'RELEASED'" in lifecycle_mapping.group(1)
    assert "SAFE_RESPONSE" not in lifecycle_mapping.group(1)
    assert "motionIsReduced()" in lifecycle_mapping.group(1)
    assert "setLifecycle(lifecycleState)" in avatar_source


def test_history_filter_and_groups_use_only_loaded_owned_conversations():
    app_source = (Path(__file__).parents[1] / "interface" / "static" / "app.js").read_text(encoding="utf-8")
    html_source = (Path(__file__).parents[1] / "interface" / "static" / "index.html").read_text(encoding="utf-8")
    render = re.search(r"function renderHistory\(\) \{(.*?)\n\}", app_source, re.DOTALL)
    assert render is not None

    assert 'id="history-filter"' in html_source
    assert "state.serverConversationIds.has(session.id)" in render.group(1)
    assert "session.messages.some((message) => String(message.text || '').toLocaleLowerCase().includes(query))" in render.group(1)
    assert "historyGroupLabel(timestamp)" in render.group(1)
    assert "No loaded conversations match this filter." in render.group(1)
    assert "apiRequest" not in render.group(1)


def test_all_viewports_enter_the_parmar_overview_before_chat():
    app_source = (Path(__file__).parents[1] / "interface" / "static" / "app.js").read_text(encoding="utf-8")
    initialize = re.search(r"function initialize\(\) \{(.*?)\n\}", app_source, re.DOTALL)
    assert initialize is not None
    assert "selectSection('home')" in initialize.group(1)


def test_home_navigation_controls_do_not_submit_or_claim_a_ready_state():
    static_dir = Path(__file__).parents[1] / "interface" / "static"
    app_source = (static_dir / "app.js").read_text(encoding="utf-8")
    html_source = (static_dir / "index.html").read_text(encoding="utf-8")
    events = re.search(r"function bindEvents\(\) \{(.*?)\n\}", app_source, re.DOTALL)
    language = re.search(r"if \(dom\.languageSelect\) \{(.*?)\n\s*\}", events.group(1), re.DOTALL)
    assert events and language
    assert 'data-section="home" data-nav-key="home"' in html_source
    assert ".sidebar-brand[data-section]" in events.group(1)
    assert 'data-section="voki"' in html_source
    assert 'aria-label="VOKKI interface"' in html_source
    home_section = re.search(r'<section class="section-view active home-command-center"[\s\S]*?(?=<section class="section-view core-workspace")', html_source)
    assert home_section is not None
    assert "NOT YET ASSESSED" in home_section.group(0)
    assert 'data-action="new-chat"' in home_section.group(0)
    assert "state.settings.language = dom.languageSelect.value" in language.group(1)
    assert "persistSettings()" in language.group(1)
    assert "analyzeRequest" not in language.group(1)
    assert '<body data-state="UNKNOWN"' in html_source
    assert 'data-voki-state="UNKNOWN"' in html_source
    assert 'id="status-pill" aria-live="polite">NOT ASSESSED</div>' in html_source
