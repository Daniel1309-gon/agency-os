# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Arnés local que simula TalkyTimes para el piloto mTLS.

Sirve HTTPS en 127.0.0.1:443 para el hostname `talkytimes.com` (resuelto por el
archivo hosts) con las señales que el agente espera:

- `/auth/login`: dos `button[type=submit]` (el primero es señuelo de registro),
  el real con `title="Submit"`, e `svg#EyeOff` junto al campo de contraseña.
- `POST /auth/verify`: acepta únicamente el usuario/contraseña ficticios del
  ensayo; con éxito redirige a `/search/all`.
- `/search/all`: página sin campo de contraseña.

Registra cada intento en un log sin escribir la contraseña.

Uso:
  uv run tools/talkytimes-harness.py --expected-email alma.demo@talkytimes.test \
    --expected-password <ficticia> --log .local/mtls-pilot/talkytimes-harness/access.log
"""

from __future__ import annotations

import argparse
import json
import ssl
import sys
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs

ROOT = Path(__file__).resolve().parents[1]
LOGIN_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Login | TalkyTimes</title></head>
<body>
  <main>
    <h1>Welcome to TalkyTimes</h1>
    <form method="post" action="/auth/verify">
      <label>Email <input type="email" name="email" autocomplete="off"></label>
      <label>Password
        <span class="password-field">
          <input type="password" name="password" autocomplete="off">
          <svg id="EyeOff" viewBox="0 0 24 24" width="20" height="20"><path d="M2 2 L22 22"/></svg>
        </span>
      </label>
      <button type="submit" formaction="/auth/join">Join talkytimes &rarr;</button>
      <button type="submit" title="Submit">Log in</button>
    </form>
  </main>
</body></html>
"""
ERROR_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Login | TalkyTimes</title></head>
<body>
  <main>
    <h1>Invalid credentials</h1>
    <form method="post" action="/auth/verify">
      <label>Email <input type="email" name="email"></label>
      <label>Password <input type="password" name="password"></label>
      <button type="submit" title="Submit">Log in</button>
    </form>
  </main>
</body></html>
"""
SEARCH_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Search | TalkyTimes</title></head>
<body><main><h1>Search</h1><p>Harness de ensayo; sin campo de contrasena.</p></main></body></html>
"""


class HarnessHandler(BaseHTTPRequestHandler):
    server: "HarnessServer"

    def log_message(self, *args: object) -> None:  # noqa: D102
        return

    def _send(self, status: int, body: str, location: str | None = None) -> None:
        payload = body.encode("utf-8")
        self.send_response(status)
        if location:
            self.send_header("location", location)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _record(self, entry: dict[str, object]) -> None:
        line = json.dumps({"at": datetime.now(timezone.utc).isoformat(), **entry})
        with self.server.log_path.open("a", encoding="utf8") as handle:
            handle.write(line + "\n")

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?")[0]
        if path == "/auth/login":
            self._record({"method": "GET", "path": path, "event": "login_page"})
            self._send(200, LOGIN_PAGE)
            return
        if path == "/search/all":
            self._record({"method": "GET", "path": path, "event": "search_page"})
            self._send(200, SEARCH_PAGE)
            return
        if path == "/":
            self._send(302, "", location="/auth/login")
            return
        self._record({"method": "GET", "path": path, "event": "not_found"})
        self._send(404, "<h1>Not found</h1>")

    def do_POST(self) -> None:  # noqa: N802
        path = self.path.split("?")[0]
        length = int(self.headers.get("content-length", "0"))
        raw = self.rfile.read(length).decode("utf-8", errors="replace") if length else ""
        form = parse_qs(raw)
        email = (form.get("email") or [""])[0]
        password = (form.get("password") or [""])[0]
        if path == "/auth/verify":
            ok = email == self.server.expected_email and password == self.server.expected_password
            self._record({
                "method": "POST",
                "path": path,
                "event": "login_attempt",
                "email": email,
                "password_length": len(password),
                "credential_ok": ok,
            })
            if ok:
                self._send(303, "", location="/search/all")
            else:
                self._send(200, ERROR_PAGE)
            return
        if path == "/auth/join":
            self._record({"method": "POST", "path": path, "event": "decoy_button_clicked"})
            self._send(200, "<h1>Join flow (decoy)</h1>")
            return
        self._record({"method": "POST", "path": path, "event": "not_found"})
        self._send(404, "<h1>Not found</h1>")


class HarnessServer(ThreadingHTTPServer):
    def __init__(self, address: tuple[str, int], log_path: Path, expected_email: str, expected_password: str) -> None:
        super().__init__(address, HarnessHandler)
        self.log_path = log_path
        self.expected_email = expected_email
        self.expected_password = expected_password


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cert", type=Path, default=ROOT / ".local" / "mtls-pilot" / "talkytimes-harness" / "server.crt")
    parser.add_argument("--key", type=Path, default=ROOT / ".local" / "mtls-pilot" / "talkytimes-harness" / "server.key")
    parser.add_argument("--log", type=Path, default=ROOT / ".local" / "mtls-pilot" / "talkytimes-harness" / "access.log")
    parser.add_argument("--expected-email", required=True)
    parser.add_argument("--expected-password", required=True)
    parser.add_argument("--port", type=int, default=443)
    args = parser.parse_args()

    if not args.cert.is_file() or not args.key.is_file():
        print(f"Faltan certificado o clave del arnés: {args.cert} / {args.key}", file=sys.stderr)
        return 1
    args.log.parent.mkdir(parents=True, exist_ok=True)

    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(str(args.cert), str(args.key))
    server = HarnessServer(("127.0.0.1", args.port), args.log, args.expected_email, args.expected_password)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    print(f"TalkyTimes harness escuchando en https://talkytimes.com:{args.port} (log: {args.log})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
