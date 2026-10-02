"""Modern PARMAR UI foundation served by the Python standard library."""

from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from PARMAR.chat.context import ChatContext
from PARMAR.chat.orchestration import SINGLE_PROVIDER, VERIFIED_MULTI_MODEL
from PARMAR.chat.service import ChatService
from PARMAR.chat.readiness import ProviderConfigurationRegistry
from PARMAR.interface.ui_adapter import PARMARUIAdapter
from PARMAR.interface.approvals import PendingApprovalStore
from PARMAR.phone.phone_awareness import PhoneAwarenessModule
from PARMAR.simulation.scenarios import get_scenarios

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
INDEX_FILE = STATIC_DIR / "index.html"
MAX_POST_BODY_BYTES = 1_048_576
PENDING_APPROVALS = PendingApprovalStore()
PHONE_AWARENESS = PhoneAwarenessModule()


class PARMARRequestHandler(BaseHTTPRequestHandler):
    """Serve the futuristic PARMAR interface and its API."""

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/api/providers":
            self._send_json(200, ProviderConfigurationRegistry.discover().public_payload())
            return
        if parsed.path == "/":
            self._serve_file(INDEX_FILE)
            return
        if parsed.path.startswith("/static/"):
            root = STATIC_DIR.resolve()
            target = (root / unquote(parsed.path.removeprefix("/static/"))).resolve()
            try:
                target.relative_to(root)
            except ValueError:
                self.send_error(404, "Not found")
                return
            if target.is_file():
                self._serve_file(target)
                return
        if parsed.path == "/api/scenarios":
            self._send_json(200, {"scenarios": get_scenarios()})
            return
        if parsed.path == "/api/phone":
            self._send_json(200, PHONE_AWARENESS.get_status())
            return
        self.send_error(404, "Not found")

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        raw_content_length = self.headers.get("Content-Length", "0")
        try:
            content_length = int(raw_content_length)
        except (TypeError, ValueError):
            self.send_error(400, "Invalid Content-Length")
            return
        if content_length < 0:
            self.send_error(400, "Invalid Content-Length")
            return
        if content_length > MAX_POST_BODY_BYTES:
            self.send_error(413, "Request body too large")
            return
        body = self.rfile.read(content_length) if content_length > 0 else b"{}"
        try:
            payload = json.loads(body.decode("utf-8") or "{}")
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_error(400, "Invalid JSON")
            return
        if not isinstance(payload, dict):
            self.send_error(400, "JSON body must be an object")
            return

        if parsed.path == "/api/analyze":
            request_value = payload.get("request", "")
            if not isinstance(request_value, str):
                self.send_error(400, "Request must be a string")
                return
            request_text = request_value.strip()
            result, dashboard, summary = PARMARUIAdapter.analyze_request_with_dashboard(
                request_text,
                language=str(payload.get("language", "en")),
            )
            if (
                dashboard is not None
                and summary is not None
                and result.get("status") == "APPROVAL_REQUIRED"
                and summary.get("enforcement", {}).get("status") == "HUMAN_APPROVAL_REQUIRED"
            ):
                result["approval_id"] = PENDING_APPROVALS.create(
                    request_text,
                    result.copy(),
                    dashboard,
                    summary,
                )
            self._send_json(200, result)
            return

        if parsed.path == "/api/approval":
            approval_id = payload.get("approval_id")
            decision = payload.get("decision")
            request_text = payload.get("request")
            if request_text is not None and not isinstance(request_text, str):
                self.send_error(400, "Request must be a string when supplied")
                return
            if not isinstance(decision, str):
                self.send_error(400, "Decision must be a string")
                return
            decision = decision.strip().upper()
            if decision not in {"APPROVE", "APPROVED", "REJECT", "REJECTED", "INFO", "ALTERNATIVE"}:
                self.send_error(400, "Unsupported decision")
                return
            pending = PENDING_APPROVALS.inspect(approval_id)
            if pending is None:
                self._send_json(410, {
                    "status": "APPROVAL_INVALID",
                    "safe": False,
                    "message": "The pending approval is missing, expired, or already used.",
                })
                return
            if request_text is not None and request_text.strip() != pending.request_text:
                self._send_json(409, {
                    "status": "APPROVAL_REQUEST_MISMATCH",
                    "safe": False,
                    "message": "The supplied request does not match the pending review.",
                })
                return
            if decision in {"INFO", "ALTERNATIVE"}:
                result = pending.response.copy()
                result["approval_id"] = approval_id
                result["message"] = (
                    "Review the recorded risks and safer alternative before deciding."
                    if decision == "INFO"
                    else "The safer alternative is displayed in the review. The original proposal remains pending."
                )
                self._send_json(200, result)
                return
            pending, state = PENDING_APPROVALS.consume(
                approval_id,
                request_text=request_text.strip() if request_text is not None else None,
            )
            if pending is None:
                status = 409 if state == "REQUEST_MISMATCH" else 410
                self._send_json(status, {
                    "status": "APPROVAL_INVALID",
                    "safe": False,
                    "message": "The pending approval is missing, expired, mismatched, or already used.",
                })
                return
            result = PARMARUIAdapter.apply_pending_human_decision(
                pending.response.copy(),
                pending.dashboard,
                pending.summary,
                decision,
            )
            result.pop("approval_id", None)
            self._send_json(200, result)
            return

        if parsed.path == "/api/chat":
            message = str(payload.get("message") or "").strip()
            orchestration_mode = payload.get("orchestration_mode", SINGLE_PROVIDER)
            if not isinstance(orchestration_mode, str) or orchestration_mode not in {
                SINGLE_PROVIDER,
                VERIFIED_MULTI_MODEL,
            }:
                self._send_json(400, {
                    "safe": False,
                    "status": "INVALID_ORCHESTRATION_MODE",
                    "message": "The requested orchestration mode is not supported.",
                    "provider_error": True,
                })
                return
            context_payload = payload.get("context")
            requested_memory = context_payload.get("memory") if isinstance(context_payload, dict) else None
            context = ChatContext(
                language=str(payload.get("language", "en")),
                memory=requested_memory,
            ) if isinstance(requested_memory, list) else None
            if context is not None and not context.memory:
                context = None
            recent_messages = context_payload.get("recent_messages") if isinstance(context_payload, dict) else None
            service = ChatService()
            service_options = {}
            if isinstance(recent_messages, list) and recent_messages:
                service_options["recent_messages"] = recent_messages
            if "provider" in payload:
                service_options["selected_provider"] = payload.get("provider")
            if "orchestration_mode" in payload:
                service_options["orchestration_mode"] = orchestration_mode
            response = service.respond(message, context=context, **service_options)
            self._send_json(200, response)
            return

        if parsed.path == "/api/phone":
            module = PHONE_AWARENESS
            action = str(payload.get("action") or "status").lower()

            if action == "toggle_permission":
                enabled = bool(payload.get("enabled", True))
                if enabled:
                    module.grant_permission("phone_awareness")
                else:
                    module.revoke_permission("phone_awareness")
                self._send_json(200, {
                    "success": True,
                    "enabled": module.has_permission("phone_awareness"),
                    "status": module.get_status(),
                    "message": "Phone awareness permission was updated.",
                })
                return

            if action == "simulate_event":
                event = payload.get("event") or {"event_type": "battery_low", "source": "simulated"}
                result = module.process_event(event)
                self._send_json(200, {
                    "success": True,
                    "status": result.get("status", "SAFE_TO_CONTINUE"),
                    "result": result,
                    "message": result.get("explanation", "Phone awareness simulation completed."),
                })
                return

            self._send_json(200, module.get_status())
            return

        self.send_error(404, "Not found")

    def _serve_file(self, file_path: Path) -> None:
        try:
            content = file_path.read_bytes()
        except FileNotFoundError:
            self.send_error(404, "Not found")
            return

        mime_type = "text/html"
        if file_path.suffix == ".css":
            mime_type = "text/css"
        elif file_path.suffix == ".js":
            mime_type = "application/javascript"
        elif file_path.suffix == ".json":
            mime_type = "application/json"

        self.send_response(200)
        self.send_header("Content-Type", mime_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def _send_json(self, status_code: int, payload: dict) -> None:
        body = json.dumps(payload, indent=2).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return


def main() -> None:
    host = os.environ.get("PARMAR_UI_HOST", "127.0.0.1").strip() or "127.0.0.1"
    port = 8000
    server = ThreadingHTTPServer((host, port), PARMARRequestHandler)
    print(f"PARMAR UI is running at http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
