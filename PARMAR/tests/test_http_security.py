import io
from types import SimpleNamespace

import pytest

from PARMAR.interface import futuristic_app


def make_request(path, *, body=b"", content_length=None):
    errors = []
    served = []
    request = SimpleNamespace(
        path=path,
        headers={
            "Content-Length": str(len(body) if content_length is None else content_length),
        },
        rfile=io.BytesIO(body),
        send_error=lambda status, message: errors.append((status, message)),
        _serve_file=lambda target: served.append(target),
        _send_json=lambda status, payload: None,
    )
    return request, errors, served


def test_static_request_rejects_parent_traversal():
    request, errors, served = make_request("/static/%2e%2e/README.md")

    futuristic_app.PARMARRequestHandler.do_GET(request)

    assert errors == [(404, "Not found")]
    assert served == []


def test_static_request_rejects_symlink_escape(tmp_path, monkeypatch):
    static_root = tmp_path / "static"
    static_root.mkdir()
    outside_file = tmp_path / "private.txt"
    outside_file.write_text("private", encoding="utf-8")
    (static_root / "outside.txt").symlink_to(outside_file)
    monkeypatch.setattr(futuristic_app, "STATIC_DIR", static_root)
    request, errors, served = make_request("/static/outside.txt")

    futuristic_app.PARMARRequestHandler.do_GET(request)

    assert errors == [(404, "Not found")]
    assert served == []


@pytest.mark.parametrize(
    ("body", "content_length", "expected_status"),
    [
        (b"{invalid", None, 400),
        (b"[]", None, 400),
        (b"{}", "not-a-number", 400),
        (b"", -1, 400),
        (b"", futuristic_app.MAX_POST_BODY_BYTES + 1, 413),
    ],
)
def test_post_rejects_invalid_or_oversized_json(body, content_length, expected_status):
    request, errors, _ = make_request(
        "/api/chat",
        body=body,
        content_length=content_length,
    )

    futuristic_app.PARMARRequestHandler.do_POST(request)

    assert errors
    assert errors[0][0] == expected_status


@pytest.mark.parametrize(("environment", "expected_host"), [(None, "127.0.0.1"), ("0.0.0.0", "0.0.0.0")])
def test_server_host_defaults_to_loopback_and_allows_explicit_override(monkeypatch, environment, expected_host):
    captured = {}

    class FakeServer:
        def __init__(self, address, handler):
            captured["address"] = address

        def serve_forever(self):
            raise KeyboardInterrupt

        def server_close(self):
            captured["closed"] = True

    if environment is None:
        monkeypatch.delenv("PARMAR_UI_HOST", raising=False)
    else:
        monkeypatch.setenv("PARMAR_UI_HOST", environment)
    monkeypatch.setattr(futuristic_app, "ThreadingHTTPServer", FakeServer)

    futuristic_app.main()

    assert captured["address"] == (expected_host, 8000)
    assert captured["closed"] is True
