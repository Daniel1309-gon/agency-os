# /// script
# requires-python = ">=3.11"
# dependencies = ["selenium>=4.20"]
# ///
"""Pruebas del cliente HTTP mTLS del agente local.

Levanta un servidor HTTPS local que exige certificado de cliente y comprueba:
- certificado válido: la petición es aceptada;
- sin certificado: la conexión es rechazada;
- certificado de servidor no confiable: la conexión es rechazada;
- redirección: no se sigue (la petición autenticada no se reenvía a otro destino);
- configuración parcial o archivos inválidos: error al arrancar.

Ejecutar: uv run tools/test-local-agent-mtls.py
"""

from __future__ import annotations

import importlib.util
import json
import ssl
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request

ROOT = Path(__file__).resolve().parents[1]
AGENT_PATH = ROOT / "tools" / "agency-os-local-agent.py"
OPENSSL = Path(r"C:\Program Files\Git\usr\bin\openssl.exe")


def load_agent_module():
    spec = importlib.util.spec_from_file_location("agency_os_local_agent", AGENT_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    # dataclasses necesita el módulo registrado para resolver sus tipos.
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def openssl(*args: str) -> None:
    result = subprocess.run([str(OPENSSL), *args], capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"openssl falló: {args[0]}\n{result.stderr}")


def make_pki(root: Path) -> dict[str, Path]:
    """CA, certificado de servidor y certificado de cliente para localhost."""
    ca_key, ca_crt = root / "ca.key", root / "ca.crt"
    server_key, server_csr, server_crt = root / "server.key", root / "server.csr", root / "server.crt"
    client_key, client_csr, client_crt = root / "client.key", root / "client.csr", root / "client.crt"
    ext = root / "server.ext"
    ext.write_text("subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n", encoding="utf8")
    client_ext = root / "client.ext"
    client_ext.write_text("extendedKeyUsage=clientAuth\n", encoding="utf8")
    ca_ext = root / "ca.ext"
    ca_ext.write_text("basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n", encoding="utf8")

    openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", "/CN=Agent Test CA",
            "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign",
            "-keyout", str(ca_key), "-out", str(ca_crt))
    openssl("req", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=localhost",
            "-keyout", str(server_key), "-out", str(server_csr))
    openssl("x509", "-req", "-days", "2", "-sha256", "-in", str(server_csr), "-CA", str(ca_crt),
            "-CAkey", str(ca_key), "-CAcreateserial", "-extfile", str(ext), "-out", str(server_crt))
    openssl("req", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=agent-test-client",
            "-keyout", str(client_key), "-out", str(client_csr))
    openssl("x509", "-req", "-days", "2", "-sha256", "-in", str(client_csr), "-CA", str(ca_crt),
            "-CAkey", str(ca_key), "-CAcreateserial", "-extfile", str(client_ext), "-out", str(client_crt))
    return {"ca_crt": ca_crt, "server_key": server_key, "server_crt": server_crt, "client_key": client_key, "client_crt": client_crt}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args) -> None:
        return

    def do_POST(self) -> None:
        if self.path == "/redirect":
            self.send_response(302)
            self.send_header("location", "/elsewhere")
            self.end_headers()
            return
        length = int(self.headers.get("content-length", "0"))
        self.rfile.read(length)
        body = json.dumps({"ok": True}).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def start_server(pki: dict[str, Path], require_client: bool) -> tuple[ThreadingHTTPServer, int]:
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(str(pki["server_crt"]), str(pki["server_key"]))
    if require_client:
        context.verify_mode = ssl.CERT_REQUIRED
        context.load_verify_locations(str(pki["ca_crt"]))
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, server.server_address[1]


def raw_post(opener, url: str, body: dict[str, object]) -> int:
    request = Request(url, data=json.dumps(body).encode(), method="POST", headers={"content-type": "application/json"})
    with opener.open(request, timeout=10) as response:
        response.read()
        return response.status


def main() -> int:
    if not OPENSSL.is_file():
        print("OpenSSL de Git for Windows no está disponible; prueba omitida.")
        return 0
    agent = load_agent_module()
    failures: list[str] = []

    with tempfile.TemporaryDirectory(prefix="agent-mtls-") as tmp:
        pki = make_pki(Path(tmp))
        server, port = start_server(pki, require_client=True)
        base = f"https://localhost:{port}"
        body = {"sessionId": "123e4567-e89b-12d3-a456-426614174001"}

        # Certificado válido: aceptado. El test inyecta la CA de prueba; el
        # agente real usa el bundle de certifi para el certificado público.
        opener = agent.build_http_opener(pki["client_crt"], pki["client_key"], ca_file=pki["ca_crt"])
        try:
            result = agent.api_json(base, "/ok", "POST", body, opener)
            if result.get("ok") is not True:
                failures.append("valid client certificate did not reach the server")
        except Exception as exc:  # noqa: BLE001
            failures.append(f"valid client certificate rejected: {type(exc).__name__}")

        # Sin certificado de cliente: el servidor exige uno. Se confía en la CA
        # del servidor (mismo ca_file que el caso válido) para que el rechazo no
        # pueda atribuirse a desconfianza hacia el servidor. El servidor corta la
        # conexión con la alerta TLS de certificado requerido o con un reset
        # según el timing; cualquiera de los dos es un rechazo del servidor.
        plain = agent.build_http_opener(ca_file=pki["ca_crt"])
        try:
            raw_post(plain, f"{base}/ok", body)
            failures.append("request without client certificate was accepted")
        except (ssl.SSLError, URLError, ConnectionResetError) as exc:
            reason = exc.reason if isinstance(exc, URLError) else exc
            text = str(reason).lower()
            if "certificate verify failed" in text:
                failures.append(f"without-client-cert case failed on server trust, not on the missing client cert: {reason}")
        except Exception as exc:  # noqa: BLE001
            failures.append(f"without-client-cert case raised {type(exc).__name__}: {exc}")

        # Redirect: no se sigue.
        try:
            agent.api_json(base, "/redirect", "POST", body, opener)
            failures.append("redirect was followed")
        except agent.ApiFailure as exc:
            if exc.status != 302:
                failures.append(f"redirect produced unexpected status: {exc.status}")
        except Exception as exc:  # noqa: BLE001
            failures.append(f"redirect produced unexpected error: {type(exc).__name__}")

        # Certificado de servidor no confiable: rechazado por verificación de
        # certificado del servidor (sin CA explícita usa el bundle de certifi).
        untrusted = agent.build_http_opener(pki["client_crt"], pki["client_key"])
        try:
            raw_post(untrusted, f"{base}/ok", body)
            failures.append("untrusted server certificate was accepted")
        except (ssl.SSLError, URLError) as exc:
            reason = exc.reason if isinstance(exc, URLError) else exc
            if "certificate verify failed" not in str(reason).lower():
                failures.append(f"untrusted server rejected for an unexpected reason: {reason}")
        except Exception as exc:  # noqa: BLE001
            failures.append(f"untrusted server raised {type(exc).__name__} instead of a verification error: {exc}")

        server.shutdown()
        server.server_close()

        # Configuración parcial: error explícito.
        try:
            agent.build_http_opener(pki["client_crt"], None)
            failures.append("partial mTLS configuration was accepted")
        except ValueError:
            pass

        # Archivos inválidos: error al cargar.
        broken = Path(tmp) / "broken.pem"
        broken.write_text("not a certificate", encoding="utf8")
        try:
            agent.build_http_opener(broken, broken)
            failures.append("invalid certificate files were accepted")
        except (ssl.SSLError, OSError, ValueError):
            pass

    if failures:
        for failure in failures:
            print(f"FAIL: {failure}")
        return 1
    print("mtls client tests: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
