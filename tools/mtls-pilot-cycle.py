# /// script
# requires-python = ">=3.11"
# dependencies = ["selenium>=4.20", "certifi>=2024.2.2"]
# ///
"""Ejercita el ciclo operativo completo del piloto a través de Cloudflare.

Canje, estado, heartbeat y cierre con certificado de cliente y token de
dispositivo reales. No imprime secretos de perfil.

Uso:
  uv run tools/mtls-pilot-cycle.py [--profile-name "Alma Demo"]
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path
from urllib.request import Request

ROOT = Path(__file__).resolve().parents[1]
HOST = "mtls-pilot.globalcompany.company"
UA = "AgencyOS-Local-Agent/0.1"


def load_agent_module():
    spec = importlib.util.spec_from_file_location("agency_os_local_agent", ROOT / "tools" / "agency-os-local-agent.py")
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile-name", default="Alma Demo")
    parser.add_argument("--web-origin", default=f"https://{HOST}")
    parser.add_argument("--mtls-dir", type=Path, default=ROOT / ".local" / "mtls-pilot" / "mtls")
    parser.add_argument("--agent-dir", type=Path, default=ROOT / ".local" / "mtls-pilot" / "agent")
    parser.add_argument("--secrets-dir", type=Path, default=ROOT / ".local" / "mtls-pilot" / "secrets")
    parser.add_argument("--cert-name", default="agency-pilot-pc01")
    args = parser.parse_args()

    agent = load_agent_module()
    host = args.web_origin.removeprefix("https://").rstrip("/")
    base = f"https://{host}/api/v1"
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
            with opener.open(request, timeout=20) as response:
                return response.status, json.loads(response.read().decode())
        except Exception as exc:  # noqa: BLE001
            body_text = exc.read(300).decode(errors="replace") if hasattr(exc, "read") else str(exc)
            return getattr(exc, "code", "ERR"), body_text

    status, login = call("/auth/login", {"email": "operador@agency.test", "password": operator_password})
    if status != 201:
        print("login ->", status, login)
        return 1
    jwt = login["accessToken"]

    status, assigned = call("/agent/profiles/assigned", None, jwt, "GET")
    profile = next((item for item in assigned if item["profileName"] == args.profile_name), None)
    if profile is None:
        print(f"perfil no asignado: {args.profile_name}")
        return 1
    if profile["session"]:
        call(f"/agent/sessions/{profile['session']['id']}/close", {"version": profile["session"]["version"]}, jwt, device=True)
        status, assigned = call("/agent/profiles/assigned", None, jwt, "GET")
        profile = next(item for item in assigned if item["profileName"] == args.profile_name)

    status, prepared = call("/agent/sessions/prepare", {"profileId": profile["profileId"], "assignmentId": profile["assignmentId"], "chromeProfileDir": profile["chromeProfileDir"]}, jwt)
    if status != 201:
        print("prepare ->", status, prepared)
        return 1
    session_id = prepared["id"]
    print("1. prepare ->", status, prepared["status"])

    status, claim = call("/station/credential-claims", {"profileId": profile["profileId"], "sessionId": session_id}, device=True)
    if status != 201:
        print("claim ->", status, claim)
        return 1
    print("2. claim ->", status, {"username": claim["username"], "sessionVersion": claim["sessionVersion"]})
    version = claim["sessionVersion"]

    status, active = call(f"/station/sessions/{session_id}", {"status": "ACTIVE", "version": version}, method="PATCH", device=True)
    if status != 200:
        print("active ->", status, active)
        return 1
    print("3. active ->", status, {"status": active["status"], "version": active["version"]})
    version = active["version"]

    status, beat = call(f"/station/sessions/{session_id}/heartbeat", {"version": version}, device=True)
    if status != 201:
        print("heartbeat ->", status, beat)
        return 1
    print("4. heartbeat ->", status, {"decision": beat["decision"], "version": beat["version"], "permitUntil": beat["permitUntil"]})
    version = beat["version"]

    status, closed = call(f"/station/sessions/{session_id}/close", {"version": version}, device=True)
    if status != 201:
        print("close ->", status, closed)
        return 1
    print("5. close ->", status, {"status": closed["status"], "version": closed["version"], "browserClosedAt": closed["browserClosedAt"]})
    return 0


if __name__ == "__main__":
    sys.exit(main())
