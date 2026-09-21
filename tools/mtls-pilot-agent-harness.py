# /// script
# requires-python = ">=3.11"
# dependencies = ["selenium>=4.20", "certifi>=2024.2.2"]
# ///
"""Arranca el agente local del piloto con Chrome apuntando al arnés de TalkyTimes.

Igual que el agente real (mTLS + token de dispositivo), pero Chrome resuelve
`talkytimes.com` al arnés local. Es una sustitución exclusiva de la prueba: el
agente de producción no lleva estos ajustes.

Requiere el arnés ya escuchando (tools/talkytimes-harness.py).

Uso:
  uv run tools/mtls-pilot-agent-harness.py
"""

from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_agent_module():
    spec = importlib.util.spec_from_file_location("agency_os_local_agent", ROOT / "tools" / "agency-os-local-agent.py")
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=45832)
    parser.add_argument("--api-base-url", default="https://mtls-pilot.globalcompany.company/api/v1")
    parser.add_argument("--web-origin", default="https://mtls-pilot.globalcompany.company")
    parser.add_argument("--mtls-dir", type=Path, default=ROOT / ".local" / "mtls-pilot" / "mtls")
    parser.add_argument("--agent-dir", type=Path, default=ROOT / ".local" / "mtls-pilot" / "agent")
    parser.add_argument("--slot-root", type=Path, default=ROOT / ".local" / "mtls-pilot" / "agent-slots")
    parser.add_argument("--cert-name", default="agency-pilot-pc01-v2")
    args = parser.parse_args()

    cert_file = args.mtls_dir / f"{args.cert_name}.crt"
    key_file = args.mtls_dir / f"{args.cert_name}.key"
    token_file = args.agent_dir / "device-token.txt"
    for required in (cert_file, key_file, token_file):
        if not required.is_file():
            print(f"Falta un archivo requerido: {required}", file=sys.stderr)
            return 1

    agent = load_agent_module()

    # Solo para el piloto: Chrome resuelve talkytimes.com al arnés local.
    original_options = agent.Options

    class HarnessOptions(original_options):  # type: ignore[misc, valid-type]
        def __init__(self, *option_args, **option_kwargs):
            super().__init__(*option_args, **option_kwargs)
            self.add_argument("--host-resolver-rules=MAP talkytimes.com 127.0.0.1")
            self.add_argument("--ignore-certificate-errors")

    agent.Options = HarnessOptions

    opener = agent.build_http_opener(cert_file, key_file)
    args.slot_root.mkdir(parents=True, exist_ok=True)
    runtime = agent.Agent(args.api_base_url, token_file, args.slot_root, opener)
    server = agent.Server(("127.0.0.1", args.port), runtime, args.web_origin)
    print(f"Agente del piloto escuchando en 127.0.0.1:{args.port}")
    print(f"API: {args.api_base_url}")
    print("Chrome abrirá el arnés local de TalkyTimes. Ctrl+C para detener.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        runtime.close_all()
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
