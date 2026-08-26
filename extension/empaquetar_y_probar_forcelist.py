# /// script
# requires-python = ">=3.11"
# dependencies = ["cryptography>=42"]
# ///
"""Spike: valida el mecanismo REAL de despliegue (ExtensionInstallForcelist),
no el de desarrollo (Load unpacked / --load-extension) que ya vimos que
Chrome bloquea con la restriccion de Modo Desarrollador de Windows.

Pasos, todos automatizados:
  1. Empaqueta chrome-extension/ como .crx firmado (reusa la misma llave
     .pem entre corridas para que el ID no cambie cada vez).
  2. Calcula el extension ID real a partir de la llave publica (el mismo
     algoritmo que usa Chrome: SHA256 de la clave publica DER, primeros 16
     bytes, mapeados de hex a las letras a-p).
  3. Genera update.xml (el manifest de actualizacion que Chrome consulta).
  4. Sirve update.xml + el .crx por HTTP en localhost (hilo en background).
  5. Escribe la politica ExtensionInstallForcelist en el registro (HKCU).
  6. Lanza un perfil TOTALMENTE NUEVO (nunca tocado) para confirmar que la
     extension llega sola, sin ningun paso manual ni Modo Desarrollador.

OJO: si Chrome exige HTTPS para el update_url de un forcelist (algunas
versiones lo requieren para el propio dominio de descarga del crx, aunque
localhost suele tener excepciones de "contexto seguro"), este spike lo va a
mostrar como error en chrome://policy o chrome://extensions -- revisa ahi si
el perfil nuevo no la recibe.

Uso:
    uv run empaquetar_y_probar_forcelist.py
"""
import hashlib
import http.server
import shutil
import subprocess
import sys
import threading
import time
import winreg
from pathlib import Path

from cryptography.hazmat.primitives.serialization import (
    Encoding,
    PublicFormat,
    load_pem_private_key,
)

SCRIPT_DIR = Path(__file__).parent
EXTENSION_DIR = SCRIPT_DIR / "chrome-extension"
PEM_PATH = SCRIPT_DIR / "chrome-extension.pem"
CRX_PATH = SCRIPT_DIR / "chrome-extension.crx"
UPDATE_XML_PATH = SCRIPT_DIR / "update.xml"
PUERTO = 8765

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


def empaquetar(chrome: str) -> None:
    args = [chrome, f"--pack-extension={EXTENSION_DIR}"]
    if PEM_PATH.exists():
        # Reusa la misma llave -- si no, cada empaquetado genera un ID nuevo.
        args.append(f"--pack-extension-key={PEM_PATH}")
    print("Empaquetando extension...")
    subprocess.run(args, timeout=30)
    if not CRX_PATH.exists() or not PEM_PATH.exists():
        sys.exit(
            "No se genero el .crx/.pem esperado. Revisa si Chrome mostro algun "
            "dialogo de error (a veces requiere cerrar todas las ventanas de Chrome primero)."
        )
    print(f"  {CRX_PATH.name} y {PEM_PATH.name} listos.")


def calcular_extension_id(pem_path: Path) -> str:
    clave = load_pem_private_key(pem_path.read_bytes(), password=None)
    der = clave.public_key().public_bytes(Encoding.DER, PublicFormat.SubjectPublicKeyInfo)
    hex_digest = hashlib.sha256(der).hexdigest()[:32]
    return "".join(
        chr(ord(c) - ord("0") + ord("a")) if c.isdigit() else chr(ord(c) - ord("a") + ord("k"))
        for c in hex_digest
    )


def generar_update_xml(extension_id: str, version: str) -> None:
    xml = f"""<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='{extension_id}'>
    <updatecheck codebase='http://localhost:{PUERTO}/chrome-extension.crx' version='{version}' />
  </app>
</gupdate>
"""
    UPDATE_XML_PATH.write_text(xml, encoding="utf-8")
    print(f"  update.xml generado (extension_id={extension_id})")


def servir_en_background() -> None:
    handler = lambda *args, **kwargs: http.server.SimpleHTTPRequestHandler(
        *args, directory=str(SCRIPT_DIR), **kwargs
    )
    servidor = http.server.ThreadingHTTPServer(("localhost", PUERTO), handler)
    hilo = threading.Thread(target=servidor.serve_forever, daemon=True)
    hilo.start()
    print(f"  Sirviendo {SCRIPT_DIR} en http://localhost:{PUERTO}/ (background)")


def aplicar_forcelist(extension_id: str) -> None:
    valor = f"{extension_id};http://localhost:{PUERTO}/update.xml"
    clave = winreg.CreateKey(
        winreg.HKEY_CURRENT_USER,
        r"SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist",
    )
    # Chrome reads numbered values directly from this policy key. A numbered
    # subkey is ignored and makes chrome://policy display an empty list.
    winreg.SetValueEx(clave, "1", 0, winreg.REG_SZ, valor)
    winreg.CloseKey(clave)
    print(f"  ExtensionInstallForcelist aplicada: {valor}")


def lanzar_perfil_nuevo(chrome: str) -> None:
    perfil_nuevo = SCRIPT_DIR / "chrome_profiles" / f"forcelist_test_{int(time.time())}"
    perfil_nuevo.mkdir(parents=True, exist_ok=True)
    print(f"  Lanzando perfil NUEVO (nunca tocado): {perfil_nuevo}")
    subprocess.Popen(
        [
            chrome,
            f"--user-data-dir={perfil_nuevo}",
            "--no-first-run",
            "chrome://extensions",
        ],
        close_fds=True,
    )


def main() -> None:
    if not EXTENSION_DIR.exists():
        sys.exit(f"No se encontro {EXTENSION_DIR}.")

    chrome = encontrar_chrome()
    empaquetar(chrome)

    import json

    version = json.loads((EXTENSION_DIR / "manifest.json").read_text(encoding="utf-8"))["version"]
    extension_id = calcular_extension_id(PEM_PATH)

    generar_update_xml(extension_id, version)
    servir_en_background()
    aplicar_forcelist(extension_id)

    print(
        "\nSi Chrome ya estaba abierto antes de correr esto, cierralo por completo "
        "y vuelve a correr el script -- la politica se lee al iniciar el proceso."
    )
    lanzar_perfil_nuevo(chrome)

    print("\nVerifica en chrome://extensions (se abrio solo) si la extension aparece")
    print("marcada como 'Instalada por la empresa', SIN haber tocado nada a mano.")
    time.sleep(3)


if __name__ == "__main__":
    main()
