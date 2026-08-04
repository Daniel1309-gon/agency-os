# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Spike: lanza N perfiles nativos de Chrome (uno por entrada en
credenciales.json) contra TalkyTimes, pasando a cada uno un id ligero via
query param (?agencyPerfil=N) que la extension usa para buscar su credencial
en el JSON.

Mecanismo (decision #2 de agents.md): perfiles nativos via --profile-directory,
compartiendo el user-data-dir real de Chrome. Cada perfil tiene su propia
carpeta de cookies dentro de ese user-data-dir -- aislamiento de sesion igual
que el selector de perfiles de la UI de Chrome.

OJO: si Chrome ya esta abierto, todos los perfiles se abren como ventanas
dentro de esa MISMA instancia (un solo proceso), no como N procesos
independientes. El aislamiento de cookies se mantiene, pero el consumo de RAM
es de "1 Chrome con N perfiles", no de "N Chromes".

Uso:
    uv run lanzar_perfiles_nativos.py
"""
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
CREDENCIALES_PATH = SCRIPT_DIR / "credenciales.json"
URL_BASE = "https://talkytimes.com/auth/login"
PAUSA_ENTRE_LANZAMIENTOS_SEG = 1.5

RUTAS_CHROME_WINDOWS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
]


def encontrar_chrome() -> str:
    encontrado = shutil.which("chrome") or shutil.which("google-chrome")
    if encontrado:
        return encontrado
    for ruta in RUTAS_CHROME_WINDOWS:
        if Path(ruta).exists():
            return ruta
    sys.exit("No se encontro chrome.exe. Ajusta RUTAS_CHROME_WINDOWS.")


def cargar_credenciales(path: Path) -> list[dict]:
    if not path.exists():
        sys.exit(f"No se encontro {path}. Crea credenciales.json con el mapeo perfil->credencial.")
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    credenciales = cargar_credenciales(CREDENCIALES_PATH)
    chrome = encontrar_chrome()
    n = len(credenciales)
    print(f"Lanzando {n} perfil(es) nativo(s) con Chrome:")
    print(f"  {chrome}\n")
    for c in credenciales:
        perfil = c["perfil"]
        perfil_id = c["id"]
        url = f"{URL_BASE}?agencyPerfil={perfil_id}"
        print(f"  -> perfil '{perfil}' (id={perfil_id})")
        print(f"     {url}")
        subprocess.Popen(
            [
                chrome,
                f"--profile-directory={perfil}",
                "--no-first-run",
                "--no-default-browser-check",
                url,
            ],
            close_fds=True,
        )
        time.sleep(PAUSA_ENTRE_LANZAMIENTOS_SEG)

    print("\nLanzamiento completado. Ahora, en CADA perfil/ventana:")
    print("  1. Abre chrome://extensions")
    print("  2. Activa 'Modo de desarrollador' (esquina superior derecha)")
    print("  3. 'Cargar descomprimida' -> selecciona la carpeta:")
    print(f"     {SCRIPT_DIR / 'chrome-extension'}")
    print("  4. En la card de la extension, activa 'Permitir acceso a URLs de archivo'")
    print("  5. Recarga https://talkytimes.com/auth/login?agencyPerfil=<N>")
    print("     (o navega ahi manualmente) -- la credencial se inyecta sola.")


if __name__ == "__main__":
    main()
