# /// script
# requires-python = ">=3.11"
# dependencies = ["selenium>=4.20"]
# ///
"""Abre varios perfiles de Chrome e inicia sesion en TalkyTimes.

Cada perfil usa su propio directorio de automatizacion (carpeta local
"chrome_profiles/<nombre>"), independiente de tu Chrome habitual, para
evitar el error "DevToolsActivePort file doesn't exist" que ocurre cuando
se apunta al user-data-dir de un Chrome que ya esta abierto.

Uso:
    uv run login_talkytimes.py

Requiere perfiles.json junto a este script (ver perfiles.example.json).
"""
import json
import re
import sys
import time
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

LOGIN_URL = "https://talkytimes.com/login"
SCRIPT_DIR = Path(__file__).parent
CONFIG_PATH = SCRIPT_DIR / "perfiles.json"
PROFILES_DIR = SCRIPT_DIR / "chrome_profiles"


def cargar_perfiles(path: Path) -> list[dict]:
    if not path.exists():
        sys.exit(
            f"No se encontro {path}.\n"
            "Copia perfiles.example.json a perfiles.json y completa tus perfiles/credenciales."
        )
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def slug(nombre: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]+", "_", nombre.strip()) or "perfil"


def rellenar_y_enviar_login(driver, email: str, password: str) -> None:
    wait = WebDriverWait(driver, 15)
    email_input = wait.until(
        EC.presence_of_element_located((By.CSS_SELECTOR, 'input[type="email"]'))
    )
    password_input = driver.find_element(By.CSS_SELECTOR, 'input[type="password"]')
    email_input.clear()
    email_input.send_keys(email)
    password_input.clear()
    password_input.send_keys(password)

    # Hacer clic en el boton "Log in". OJO: la pagina tiene otro
    # button[type="submit"] para "Join talkytimes" (registro) que aparece
    # antes en el DOM, por eso no alcanza con filtrar por type="submit".
    try:
        submit_button = wait.until(
            EC.element_to_be_clickable((By.CSS_SELECTOR, 'button[title="Submit"]'))
        )
    except Exception:
        submit_button = wait.until(
            EC.element_to_be_clickable(
                (By.XPATH, '//button[normalize-space(.)="Log in"]')
            )
        )
    submit_button.click()


def abrir_perfil(nombre: str, email: str, password: str):
    user_data_dir = PROFILES_DIR / slug(nombre)
    user_data_dir.mkdir(parents=True, exist_ok=True)

    options = Options()
    options.add_argument(f"--user-data-dir={user_data_dir}")
    options.add_argument("--no-first-run")
    options.add_argument("--no-default-browser-check")
    # Deja la ventana abierta al terminar el script (no cierra el navegador).
    options.add_experimental_option("detach", True)

    driver = webdriver.Chrome(options=options)
    driver.get(LOGIN_URL)
    rellenar_y_enviar_login(driver, email, password)
    return driver


def main() -> None:
    perfiles = cargar_perfiles(CONFIG_PATH)
    abiertos = 0
    for perfil in perfiles:
        nombre = perfil.get("nombre") or f"perfil_{abiertos + 1}"
        print(f"Abriendo perfil: {nombre}")
        try:
            abrir_perfil(nombre, perfil["email"], perfil["password"])
            abiertos += 1
        except Exception as exc:
            print(f"  Error en '{nombre}': {exc}")
        time.sleep(1)

    print(f"\n{abiertos}/{len(perfiles)} perfil(es) procesados con inicio de sesion enviado.")


if __name__ == "__main__":
    main()
