"""Modern PARMAR UI foundation served by the Python standard library."""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from PARMAR.chat.service import ChatService
from PARMAR.interface.ui_adapter import PARMARUIAdapter
from PARMAR.phone.phone_awareness import PhoneAwarenessModule
from PARMAR.simulation.scenarios import get_scenarios

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
INDEX_FILE = STATIC_DIR / "index.html"


class PARMARRequestHandler(BaseHTTPRequestHandler):
    """Serve the futuristic PARMAR interface and its API."""

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/":
            self._serve_file(INDEX_FILE)
            return
        if parsed.path.startswith("/static/"):
            target = STATIC_DIR / parsed.path.replace("/static/", "", 1)
            if target.exists():
                self._serve_file(target)
                return
        if parsed.path == "/api/scenarios":
            self._send_json(200, {"scenarios": get_scenarios()})
            return
        if parsed.path == "/api/phone":
            self._send_json(200, PhoneAwarenessModule().get_status())
            return
        self.send_error(404, "Not found")

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        content_length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(content_length) if content_length > 0 else b"{}"
        try:
            payload = json.loads(body.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self.send_error(400, "Invalid JSON")
            return

        if parsed.path == "/api/analyze":
            request_text = str(payload.get("request") or "").strip()
            result = PARMARUIAdapter.analyze_request(request_text, language=str(payload.get("language", "en")))
            self._send_json(200, result)
            return

        if parsed.path == "/api/approval":
            request_text = str(payload.get("request") or "").strip()
            decision = str(payload.get("decision") or "").strip().upper()
            result = PARMARUIAdapter.process_human_decision(
                request_text,
                decision,
                language=str(payload.get("language", "en")),
            )
            self._send_json(200, result)
            return

        if parsed.path == "/api/chat":
            message = str(payload.get("message") or "").strip()
            response = ChatService().respond(message)
            self._send_json(200, response)
            return

        if parsed.path == "/api/phone":
            module = PhoneAwarenessModule()
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
    host = "127.0.0.1"
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
