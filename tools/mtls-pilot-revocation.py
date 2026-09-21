# /// script
# requires-python = ">=3.11"
# dependencies = ["selenium>=4.20", "certifi>=2024.2.2"]
# ///
"""Mide el efecto de revocar el certificado con heartbeats en curso.

Requiere una sesión ACTIVE (tools/mtls-pilot-open-session.py). Envía heartbeats
cada 10 s, imprime la hora de cada uno y detecta la primera petición rechazada.
El operador revoca el certificado en Cloudflare durante la ventana de espera.

Uso:
  uv run tools/mtls-pilot-revocation.py --wait-seconds 300
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request

ROOT = Path(__file__).resolve().parents[1]
HOST = "mtls-pilot.globalcompany.company"
UA = "AgencyOS-Local-Agent/0.1"
HEARTBEAT_SECONDS = 10


def load_agent_module():
    spec = importlib.util.spec_from_file_location("agency_os_local_agent", ROOT / "tools" / "agency-os-local-agent.py")
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile-name", default="Alma Demo")
    parser.add_argument("--wait-seconds", type=int, default=300, help="Ventana máxima para que el operador revoque")
    parser.add_argument("--mtls-dir", type=Path, default=ROOT / ".local" / "mtls-pilot" / "mtls")
    parser.add_argument("--agent-dir", type=Path, default=ROOT / ".local" / "mtls-pilot" / "agent")
    parser.add_argument("--secrets-dir", type=Path, default=ROOT / ".local" / "mtls-pilot" / "secrets")
    parser.add_argument("--cert-name", default="agency-pilot-pc01")
    args = parser.parse_args()

    agent = load_agent_module()
    base = f"https://{HOST}/api/v1"
    opener = agent.build_http_opener(args.mtls_dir / f"{args.cert_name}.crt", args.mtls_dir / f"{args.cert_name}.key")
    device_token = (args.agent_dir / "device-token.txt").read_text(encoding="utf8").strip()
    operator_password = (args.secrets_dir / "demo_user_password").read_text(encoding="utf8").strip()

    def call(path: str, body: dict[str, object] | None, jwt: str | None = None, method: str = "POST", device: bool = False):
        headers = {"content-type": "application/json", "user-agent": UA}
        if device:
            headers["x-device-token"] = device_token
        if jwt:
            headers["authorization"] = f"Bearer {jwt}"
        request = Request(f"{base}{path}", data=json.dumps(body).encode() if body is not None else None, headers=headers, method=method)
        try:
            with opener.open(request, timeout=15) as response:
                return response.status, json.loads(response.read().decode())
        except Exception as exc:  # noqa: BLE001
            body_text = exc.read(200).decode(errors="replace") if hasattr(exc, "read") else str(exc)
            return getattr(exc, "code", "ERR"), body_text

    status, login = call("/auth/login", {"email": "operador@agency.test", "password": operator_password})
    if status != 201:
        print("login ->", status, login)
        return 1
    jwt = login["accessToken"]

    status, assigned = call("/agent/profiles/assigned", None, jwt, "GET")
    profile = next((item for item in assigned if item["profileName"] == args.profile_name), None)
    if profile is None or not profile.get("session") or profile["session"]["status"] != "ACTIVE":
        print("No hay sesión ACTIVE; ejecute primero tools/mtls-pilot-open-session.py")
        return 1
    session_id = profile["session"]["id"]
    version = profile["session"]["version"]

    started = time.monotonic()
    last_ok: str | None = None
    last_ok_version = version
    first_rejected: str | None = None
    first_rejected_detail = ""
    print(f"sessionId={session_id} version={version} heartbeats cada {HEARTBEAT_SECONDS}s")
    print(f"REVOCAR AHORA en Cloudflare: SSL/TLS > Client Certificates > agency-pilot-pc01 > Revoke")
    print(f"Ventana: {args.wait_seconds}s. Este proceso termina al detectar el rechazo.")

    while time.monotonic() - started < args.wait_seconds:
        status_code, payload = call(f"/station/sessions/{session_id}/heartbeat", {"version": last_ok_version}, device=True)
        stamp = now_iso()
        if status_code == 201 and isinstance(payload, dict) and payload.get("decision") == "CONTINUE":
            last_ok = stamp
            last_ok_version = payload["version"]
            print(f"[{stamp}] heartbeat OK v{last_ok_version} permitUntil={payload['permitUntil']}")
        else:
            first_rejected = stamp
            first_rejected_detail = f"HTTP {status_code}: {str(payload)[:160]}"
            print(f"[{stamp}] RECHAZADO {first_rejected_detail}")
            break
        time.sleep(HEARTBEAT_SECONDS)

    print("\nResumen:")
    print(f"- último heartbeat aceptado:  {last_ok}")
    print(f"- primera petición rechazada: {first_rejected} {first_rejected_detail}")
    if last_ok and first_rejected:
        delta = datetime.fromisoformat(first_rejected) - datetime.fromisoformat(last_ok)
        print(f"- ventana entre ambos:        {delta.total_seconds():.0f}s")
    print(f"- vencimiento del permiso local del agente: último heartbeat + 30s máximo")
    if first_rejected is None:
        print("- sin rechazo dentro de la ventana (¿se revocó el certificado?)")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
