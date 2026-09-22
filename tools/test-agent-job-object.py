# /// script
# requires-python = ">=3.11"
# dependencies = ["selenium>=4.20"]
# ///
"""Comprueba que el Job Object mata a los hijos cuando el agente muere de golpe.

Un subproceso carga el agente, instala el job, lanza un hijo inofensivo y muere
con os._exit (sin cleanup). El hijo debe desaparecer: es el mismo mecanismo que
protege a chromedriver y a los Chrome de trabajo.

Ejecutar: uv run tools/test-agent-job-object.py
"""

from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AGENT_PATH = ROOT / "tools" / "agency-os-local-agent.py"

AGENT_CHILD = r"""
import importlib.util
import os
import subprocess
import sys

spec = importlib.util.spec_from_file_location("agency_os_local_agent", sys.argv[1])
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
assert module.install_kill_on_close_job(), "el job object no se pudo instalar"
sleeper = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"])
print(sleeper.pid, flush=True)
os._exit(0)
"""


def alive(pid: int) -> bool:
    result = subprocess.run(
        ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
        capture_output=True, text=True, check=False,
    )
    return str(pid) in result.stdout


def main() -> None:
    assert sys.platform == "win32", "el job object solo aplica a Windows"
    agent = subprocess.Popen(
        [sys.executable, "-c", AGENT_CHILD, str(AGENT_PATH)],
        stdout=subprocess.PIPE, text=True,
    )
    pid = int(agent.stdout.readline().strip())
    assert agent.wait(timeout=60) == 0
    deadline = time.time() + 10
    while alive(pid) and time.time() < deadline:
        time.sleep(0.5)
    assert not alive(pid), f"el hijo {pid} sobrevivio a la muerte del agente"
    print("ok: el hijo del agente muere con el job object")


if __name__ == "__main__":
    main()
