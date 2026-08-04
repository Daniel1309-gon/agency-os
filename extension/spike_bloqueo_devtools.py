# /// script
# requires-python = ">=3.11"
# dependencies = ["selenium>=4.20"]
# ///
"""Spike: valida dos mitigaciones para el problema de la contraseña visible
(ver agents.md, discusion sobre el boton "ver contraseña" + DevTools):

1. Politica de Chrome que deshabilita DevTools (F12 / clic derecho / view-source).
2. Ocultar/inhabilitar el boton de "ver contraseña" antes de que el operador
   pueda hacer clic, inyectando JS que corre antes que el script de la pagina.

IMPORTANTE: esto usa CDP (via Selenium) solo para el spike, como pidio el
usuario ("por ahora en CDP"). NO es la arquitectura final -- la version de
produccion usa la extension de Chrome (content script, sin CDP/remote-
debugging) para no dejar huella de automatizacion. Este script tampoco toca
TalkyTimes en ningun momento: abre una pagina local de prueba
(test_login_page.html) que simula el mismo patron de UI.

Uso:
    uv run spike_bloqueo_devtools.py

Solo Windows (la politica de registro que usa es especifica de Windows).
"""
import sys
import time
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.chrome.options import Options

SCRIPT_DIR = Path(__file__).parent
TEST_PAGE = SCRIPT_DIR / "test_login_page.html"
PROFILE_DIR = SCRIPT_DIR / "chrome_profiles" / "spike_devtools"

# Se ejecuta ANTES de que corra cualquier script de la pagina (via
# Page.addScriptToEvaluateOnNewDocument), para que el boton de "ver
# contraseña" quede oculto/inerte desde el primer render -- no despues de
# que el operador ya pudo hacer clic.
HIDE_TOGGLE_JS = """
(function () {
  function ocultarToggle() {
    document.querySelectorAll(
      '#toggle-password, [aria-label*="password" i][role="button"], button[class*="eye" i]'
    ).forEach((el) => {
      el.style.display = 'none';
      el.disabled = true;
      el.remove();
    });
  }
  document.addEventListener('DOMContentLoaded', ocultarToggle);
  new MutationObserver(ocultarToggle).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
"""

# Bloqueo blando de F12 / clic derecho a nivel JS. OJO: esto es defensa
# adicional, NO el mecanismo real -- se puede saltar desde el menu de
# Chrome (los tres puntos > Mas herramientas > Herramientas de desarrollador).
# El mecanismo real es la politica DeveloperToolsAvailability de mas abajo.
BLOCK_DEVTOOLS_JS = """
document.addEventListener('keydown', (e) => {
  if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && ['I', 'J', 'C'].includes(e.key))) {
    e.preventDefault();
  }
});
document.addEventListener('contextmenu', (e) => e.preventDefault());
"""


def aplicar_politica_devtools_deshabilitado() -> bool:
    """Escribe DeveloperToolsAvailability=2 (disallowed) en HKEY_CURRENT_USER.

    No requiere admin, pero solo aplica al usuario actual de Windows. Para
    que aplique a todos los usuarios de la PC de oficina se necesita la
    misma clave en HKEY_LOCAL_MACHINE, que si requiere permisos de
    administrador -- eso es lo que se usaria en el despliegue real via el
    instalador del helper, no algo que un operador active el mismo.
    """
    if sys.platform != "win32":
        print("Politica de registro omitida: no es Windows.")
        return False

    import winreg

    try:
        key = winreg.CreateKey(winreg.HKEY_CURRENT_USER, r"SOFTWARE\Policies\Google\Chrome")
        winreg.SetValueEx(key, "DeveloperToolsAvailability", 0, winreg.REG_DWORD, 2)
        winreg.CloseKey(key)
        print("Politica DeveloperToolsAvailability=2 aplicada en HKCU.")
        return True
    except OSError as exc:
        print(f"No se pudo escribir la politica de registro: {exc}")
        return False


def abrir_perfil_con_bloqueos():
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)

    options = Options()
    options.add_argument(f"--user-data-dir={PROFILE_DIR}")
    options.add_argument("--no-first-run")
    options.add_experimental_option("detach", True)

    driver = webdriver.Chrome(options=options)
    driver.execute_cdp_cmd(
        "Page.addScriptToEvaluateOnNewDocument",
        {"source": HIDE_TOGGLE_JS + BLOCK_DEVTOOLS_JS},
    )
    driver.get(TEST_PAGE.as_uri())
    return driver


def main() -> None:
    if not TEST_PAGE.exists():
        sys.exit(f"No se encontro {TEST_PAGE}. Debe estar junto a este script.")

    politica_aplicada = aplicar_politica_devtools_deshabilitado()
    if politica_aplicada:
        print(
            "Si Chrome ya estaba abierto antes de correr esto, cierralo por "
            "completo (todas las ventanas) y vuelve a correr el script -- "
            "la politica se lee al iniciar el proceso del navegador."
        )

    abrir_perfil_con_bloqueos()

    print("\nPerfil de prueba abierto. Verifica manualmente:")
    print("  1. El boton de 'ver contraseña' (icono de ojo) no aparece.")
    print("  2. F12 y clic derecho no abren nada.")
    print("  3. Intenta tambien desde el menu de Chrome (los 3 puntos > Mas")
    print("     herramientas > Herramientas de desarrollador) -- si la politica")
    print("     tomo efecto, esa opcion deberia aparecer deshabilitada o ausente.")
    time.sleep(2)


if __name__ == "__main__":
    main()
