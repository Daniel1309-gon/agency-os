# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Spike: lanza un perfil de Chrome con la extension ya cargada, como
proceso normal del SO -- sin Selenium, sin chromedriver, sin CDP/remote-
debugging en ningun momento.

Esto es intencional: valida el paso real que hace el helper nativo en la
arquitectura decidida (agents.md §5.1) -- lanzar el proceso y no volver a
tocarlo. Todo lo que pasa despues (ocultar el icono de ver contraseña,
inyectar valores) lo hace la extension por su cuenta, via content script.

`--load-extension` simula "la extension ya esta preinstalada en el perfil"
(en produccion seria via politica ExtensionInstallForcelist, no este flag,
que solo sirve para probar localmente sin tener que cargarla a mano cada vez
en chrome://extensions).

OJO (hallazgo 2026-07-30): Chrome estable ignora `--load-extension` en
silencio desde hace varias versiones -- Google lo restringio para frenar
malware que usaba ese flag para cargar extensiones sin que el usuario se
diera cuenta. No tira error, simplemente no carga nada. Por eso este script
agrega tambien `--disable-extensions-except`, que en algunos casos sigue
funcionando, pero si aun asi no aparece la extension, la unica via
confiable para esta prueba local es cargarla UNA VEZ a mano:

    1. Corre este script para que se cree el perfil.
    2. Con esa ventana abierta, ve a chrome://extensions
    3. Activa "Modo de desarrollador" y "Cargar descomprimida" -> selecciona
       la carpeta chrome-extension/.
    4. Cierra Chrome. Las proximas veces que corras este script con el mismo
       nombre de perfil, la extension ya queda instalada en ese
       user-data-dir -- no hace falta repetir el paso.

(La produccion real no depende de esto: usa la politica
ExtensionInstallForcelist, que no tiene esta restriccion porque es la via
sancionada por Chrome para despliegue gestionado, no un flag de linea de
comandos pensado para desarrollo.)

Uso:
    uv run lanzar_perfil_con_extension.py [nombre_perfil]
"""
import shutil
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
EXTENSION_DIR = SCRIPT_DIR / "chrome-extension"
PROFILES_DIR = SCRIPT_DIR / "chrome_profiles"
URL_INICIAL = "https://talkytimes.com"

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
    sys.exit("No se encontro chrome.exe. Ajusta RUTAS_CHROME_WINDOWS si esta en otro lado.")


def main() -> None:
    if not EXTENSION_DIR.exists():
        sys.exit(f"No se encontro {EXTENSION_DIR}. Falta manifest.json/content.js ahi.")

    nombre_perfil = sys.argv[1] if len(sys.argv) > 1 else "operador_1"
    user_data_dir = PROFILES_DIR / nombre_perfil
    user_data_dir.mkdir(parents=True, exist_ok=True)

    chrome = encontrar_chrome()
    print(f"Lanzando Chrome ({chrome})")
    print(f"  Perfil: {user_data_dir}")
    print(f"  Extension: {EXTENSION_DIR}")

    # Proceso independiente: no se espera (no .wait()), no se controla
    # despues -- exactamente como debe comportarse el helper real.
    subprocess.Popen(
        [
            chrome,
            f"--user-data-dir={user_data_dir}",
            f"--load-extension={EXTENSION_DIR}",
            f"--disable-extensions-except={EXTENSION_DIR}",
            "--no-first-run",
            "--no-default-browser-check",
            URL_INICIAL,
        ],
        close_fds=True,
    )
    print("Proceso lanzado. El helper no vuelve a tocar este Chrome.")


if __name__ == "__main__":
    main()
