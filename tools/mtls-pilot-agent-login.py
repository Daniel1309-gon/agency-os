# /// script
# requires-python = ">=3.11"
# dependencies = ["selenium>=4.20", "certifi>=2024.2.2"]
# ///
"""Prueba end-to-end: el agente abre un perfil y completa el login de TalkyTimes.

Usa el arnés local (tools/talkytimes-harness.py) con resolución de
`talkytimes.com` a 127.0.0.1 y omite la validación TLS del arnés solo en Chrome.
El resto del recorrido es real: backend por Cloudflare con mTLS, canje de
credencial del vault, Chrome aislado, heartbeat y cierre.

Uso (con el arnés ya escuchando):
  uv run tools/mtls-pilot-agent-login.py --harness-log <ruta.log>
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import time
from pathlib import Path
from urllib.request import Request

ROOT = Path(__file__).resolve().parents[1]
HOST = "mtls-pilot.globalcompany.company"
UA = "AgencyOS-Local-Agent/0.1"
PROFILE_NAME = "Alma Demo"


def load_agent_module():
    spec = importlib.util.spec_from_file_location("agency_os_local_agent", ROOT / "tools" / "agency-os-local-agent.py")
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--harness-log", type=Path, default=ROOT / ".local" / "mtls-pilot" / "talkytimes-harness" / "access.log")
    parser.add_argument("--mtls-dir", type=Path, default=ROOT / ".local" / "mtls-pilot" / "mtls")
    parser.add_argument("--agent-dir", type=Path, default=ROOT / ".local" / "mtls-pilot" / "agent")
    parser.add_argument("--secrets-dir", type=Path, default=ROOT / ".local" / "mtls-pilot" / "secrets")
    parser.add_argument("--slot-root", type=Path, default=ROOT / ".local" / "mtls-pilot" / "agent-slots")
    parser.add_argument("--cert-name", default="agency-pilot-pc01-v2")
    args = parser.parse_args()

    agent = load_agent_module()

    # Chrome debe resolver talkytimes.com al arnés y aceptar su CA de ensayo.
    # Es una sustitución exclusiva de esta prueba; el agente no la lleva.
    original_options = agent.Options

    class HarnessOptions(original_options):  # type: ignore[misc, valid-type]
        def __init__(self, *option_args, **option_kwargs):
            super().__init__(*option_args, **option_kwargs)
            self.add_argument("--host-resolver-rules=MAP talkytimes.com 127.0.0.1")
            self.add_argument("--ignore-certificate-errors")

    agent.Options = HarnessOptions

    base = f"https://{HOST}/api/v1"
    opener = agent.build_http_opener(args.mtls_dir / f"{args.cert_name}.crt", args.mtls_dir / f"{args.cert_name}.key")
    operator_password = (args.secrets_dir / "demo_user_password").read_text(encoding="utf8").strip()

    def call(path: str, body: dict[str, object] | None, jwt: str | None = None, method: str = "POST", device: bool = False):
        headers = {"content-type": "application/json", "user-agent": UA}
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
    profile = next((item for item in assigned if item["profileName"] == PROFILE_NAME), None)
    if profile is None:
        print(f"perfil no asignado: {PROFILE_NAME}")
        return 1
    if profile["session"]:
        call(f"/agent/sessions/{profile['session']['id']}/close", {"version": profile["session"]["version"]}, jwt, device=True)
        status, assigned = call("/agent/profiles/assigned", None, jwt, "GET")
        profile = next(item for item in assigned if item["profileName"] == PROFILE_NAME)

    status, prepared = call("/agent/sessions/prepare", {"profileId": profile["profileId"], "assignmentId": profile["assignmentId"], "chromeProfileDir": profile["chromeProfileDir"]}, jwt)
    if status != 201:
        print("prepare ->", status, prepared)
        return 1
    session_id = prepared["id"]
    launch_url = f"https://talkytimes.com/auth/login?agencyProfile={profile['profileId']}&agencySession={session_id}"
    print(f"1. sesión preparada {session_id}")

    args.slot_root.mkdir(parents=True, exist_ok=True)
    runtime_agent = agent.Agent(base, args.slot_root, opener)
    results = runtime_agent.start([{
        "profileId": profile["profileId"],
        "sessionId": session_id,
        "chromeProfileDir": profile["chromeProfileDir"],
        "launchUrl": launch_url,
        "version": prepared["version"],
    }])
    print("2. resultado del agente:", results)
    ok = bool(results) and all(item.get("ok") for item in results)

    time.sleep(2)
    harness_events: list[dict[str, object]] = []
    if args.harness_log.is_file():
        for line in args.harness_log.read_text(encoding="utf8").splitlines():
            try:
                harness_events.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    attempts = [event for event in harness_events if event.get("event") == "login_attempt"]
    last_attempt = attempts[-1] if attempts else None
    print("3. intento registrado por el arnés:", {k: last_attempt.get(k) for k in ("email", "password_length", "credential_ok")} if last_attempt else None)
    login_ok = bool(last_attempt and last_attempt.get("credential_ok") is True)

    runtime_agent.close_all()
    status, closed = call(f"/station/sessions/{session_id}/close", {"version": prepared["version"]}, jwt, device=True)
    print("4. cierre ->", status, closed if isinstance(closed, dict) else closed)

    if ok and login_ok:
        print("RESULTADO: el agente abrió el perfil y completó el login en el arnés.")
        return 0
    print("RESULTADO: FALLO")
    return 1


if __name__ == "__main__":
    sys.exit(main())
