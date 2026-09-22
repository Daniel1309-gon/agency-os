# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Pruebas de la seleccion de certificado WinHTTP del agente.

No modifica el almacen: solo enumera y busca. Si el almacen no tiene ningun
certificado, las pruebas de exito se omiten (no fallan) y quedan las de rechazo.
Incluye una prueba local de redirecciones: el transporte no debe seguirlas.

Ejecutar: python tools/test-winhttp-selection.py
"""

from __future__ import annotations

import ctypes
import importlib.util
import shutil
import ssl
import subprocess
import sys
import tempfile
import threading
from hashlib import sha256
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools" / "agency_os_winhttp.py"
GIT_OPENSSL = Path(r"C:\Program Files\Git\usr\bin\openssl.exe")


def load_module():
    spec = importlib.util.spec_from_file_location("agency_os_winhttp", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def first_store_fingerprint(module) -> str | None:
    winhttp, crypt32 = module._load_libraries()
    del winhttp
    store = crypt32.CertOpenStore(
        module.CERT_STORE_PROV_SYSTEM,
        0,
        None,
        module.CERT_SYSTEM_STORE_CURRENT_USER | module.CERT_STORE_READONLY_FLAG,
        ctypes.c_wchar_p(module.STORE_NAME),
    )
    if not store:
        return None
    try:
        context = crypt32.CertEnumCertificatesInStore(store, None)
        if not context:
            return None
        der = ctypes.string_at(context.contents.pbCertEncoded, context.contents.cbCertEncoded)
        return sha256(der).hexdigest()
    finally:
        crypt32.CertCloseStore(store, 0)


class _RedirectHandler(BaseHTTPRequestHandler):
    def log_message(self, *_args) -> None:
        return

    def do_GET(self) -> None:  # noqa: N802 (interfaz de BaseHTTPRequestHandler)
        if self.path == "/start":
            self.send_response(302)
            self.send_header("Location", "/end")
            self.end_headers()
            return
        body = b"end"
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def _local_https_server(tmp: Path) -> tuple[HTTPServer, int, threading.Thread]:
    openssl = GIT_OPENSSL if GIT_OPENSSL.is_file() else Path(shutil.which("openssl") or "")
    if not openssl.is_file():
        raise RuntimeError("openssl no disponible para generar el certificado local")
    cert, key = tmp / "cert.pem", tmp / "key.pem"
    subprocess.run(
        [str(openssl), "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2",
         "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1",
         "-keyout", str(key), "-out", str(cert)],
        capture_output=True, check=True,
    )
    server = HTTPServer(("127.0.0.1", 0), _RedirectHandler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(str(cert), str(key))
    server.socket = context.wrap_socket(server.socket, server_side=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, server.server_address[1], thread


def check_redirects_are_not_followed(module) -> None:
    """Con el par (63, 2) WinHTTP devuelve el 302; con (109, 1) seguiria a /end."""
    winhttp, crypt32 = module._load_libraries()
    with tempfile.TemporaryDirectory() as scratch:
        server, port, thread = _local_https_server(Path(scratch))
        try:
            client = module.WinHttpClient(winhttp, crypt32, "CURRENT_USER", "", allow_untrusted_server=True)
            status, body = client.request("GET", f"https://127.0.0.1:{port}/start")
            assert status == 302, f"la redireccion se siguio (status {status}, cuerpo {body[:32]!r})"
            status, body = client.request("GET", f"https://127.0.0.1:{port}/end")
            assert (status, body) == (200, b"end"), f"respuesta inesperada del servidor local: {status}"
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


def main() -> int:
    if not hasattr(ctypes, "WinDLL"):
        print("winhttp selection tests: skipped (non-Windows)")
        return 0
    module = load_module()

    for invalid in ["", "abc", "Z" * 64, "a" * 63]:
        try:
            module.WinHttpClient.from_store("CURRENT_USER", invalid)
        except module.WinHttpError:
            continue
        raise AssertionError(f"invalid fingerprint accepted: {invalid!r}")

    client = module.WinHttpClient.from_store("CURRENT_USER", "0" * 64)
    try:
        client._find_certificate()
    except module.WinHttpCertificateNotFound:
        pass
    else:
        raise AssertionError("an unknown fingerprint selected a certificate")

    check_redirects_are_not_followed(module)

    existing = first_store_fingerprint(module)
    if existing:
        found = module.WinHttpClient.from_store("CURRENT_USER", existing)._find_certificate()
        assert found, "an existing store certificate was not selected by its SHA-256"
        client.crypt32.CertFreeCertificateContext(found)
        print("winhttp selection tests: ok (store certificate matched by SHA-256; redirects disabled)")
    else:
        print("winhttp selection tests: ok (rejection paths and redirects; empty store)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
