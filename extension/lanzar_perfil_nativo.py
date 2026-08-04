# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Spike: lanza Chrome apuntando a un perfil NATIVO ya existente (Default,
Profile 1, Profile 2, etc. -- los que ya usas a diario), via
`--profile-directory`, en vez de crear un `--user-data-dir` nuevo desde cero.

Esto es literalmente el mecanismo de la decision #2 de agents.md: perfiles
nativos de Chrome, no perfiles sinteticos aparte. No incluye
`--load-extension` (esta bloqueado por la restriccion de Modo Desarrollador
de Windows que ya viste) -- si el perfil elegido no tiene la extension
cargada todavia, cargala una vez a mano en ese perfil real desde
chrome://extensions ("Cargar descomprimida" -> chrome-extension/). Una vez
cargada en un perfil, se queda ahi entre sesiones -- es tu perfil de
siempre, no uno descartable.

Uso:
    uv run lanzar_perfil_nativo.py "Profile 1"
    uv run lanzar_perfil_nativo.py "Profile 2"
"""
import shutil
import subprocess
import sys

URL_INICIAL = "https://talkytimes.com"

RUTAS_CHROME_WINDOWS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
]


def encontrar_chrome() -> str:
    encontrado = shutil.which("chrome") or shutil.which("google-chrome")
    if encontrado:
        return encontrado
    from pathlib import Path

    for ruta in RUTAS_CHROME_WINDOWS:
        if Path(ruta).exists():
            return ruta
    sys.exit("No se encontro chrome.exe. Ajusta RUTAS_CHROME_WINDOWS si esta en otro lado.")


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(
            'Falta el nombre del perfil. Ejemplo: uv run lanzar_perfil_nativo.py "Profile 1"\n'
            "Perfiles disponibles tipicamente: Default, Profile 1, Profile 2, Profile 3."
        )

    nombre_perfil = sys.argv[1]
    chrome = encontrar_chrome()

    print(f"Lanzando Chrome ({chrome})")
    print(f"  Perfil nativo: {nombre_perfil} (user-data-dir por defecto, sin override)")

    # Sin --user-data-dir: usa la ubicacion real de Chrome
    # (%LOCALAPPDATA%\Google\Chrome\User Data). Solo se selecciona la
    # subcarpeta de perfil con --profile-directory, igual que hace el
    # selector de perfiles de la UI de Chrome.
    subprocess.Popen(
        [
            chrome,
            f"--profile-directory={nombre_perfil}",
            "--no-first-run",
            URL_INICIAL,
        ],
        close_fds=True,
    )
    print("Proceso lanzado.")


if __name__ == "__main__":
    main()
