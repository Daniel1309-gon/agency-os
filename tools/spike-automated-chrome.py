# /// script
# requires-python = ">=3.11"
# dependencies = ["selenium>=4.20"]
# ///
"""Prueba de login simultáneo con Chrome automatizado, sin la extensión."""

from __future__ import annotations

import argparse
import json
import shutil
import time
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlparse

from selenium import webdriver
from selenium.common.exceptions import TimeoutException, WebDriverException
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = ROOT / ".local" / "tt-automation-profiles.json"
LOGIN_URL = "https://talkytimes.com/auth/login"


def load_profiles(path: Path) -> list[dict[str, object]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    profiles = data.get("profiles") if isinstance(data, dict) else None
    if not isinstance(profiles, list) or not 1 <= len(profiles) <= 5:
        raise ValueError("El archivo debe contener entre 1 y 5 perfiles.")

    slots: set[int] = set()
    for profile in profiles:
        if not isinstance(profile, dict):
            raise ValueError("Cada perfil debe ser un objeto JSON.")
        name = str(profile.get("name", "")).strip()
        email = str(profile.get("email", "")).strip()
        password = profile.get("password")
        slot = profile.get("slot")
        if not name or not email or not isinstance(password, str) or not password:
            raise ValueError("Cada perfil necesita name, email y password.")
        if not isinstance(slot, int) or slot < 1 or slot > 99 or slot in slots:
            raise ValueError("Cada perfil necesita un slot entero único entre 1 y 99.")
        slots.add(slot)
    return profiles


def login(driver: webdriver.Chrome, profile: dict[str, object]) -> str:
    wait = WebDriverWait(driver, 20)
    driver.get(LOGIN_URL)
    email = wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, 'input[type="email"]')))
    password = driver.find_element(By.CSS_SELECTOR, 'input[type="password"]')
    email.send_keys(str(profile["email"]))
    password.send_keys(str(profile["password"]))
    try:
        submit = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, 'button[title="Submit"]')))
    except TimeoutException:
        submit = wait.until(EC.element_to_be_clickable((By.XPATH, '//button[normalize-space(.)="Log in"]')))
    submit.click()
    try:
        WebDriverWait(driver, 20).until(lambda current: "/auth/login" not in current.current_url)
    except TimeoutException:
        return "login-page"

    driver.get("https://talkytimes.com/")
    try:
        WebDriverWait(driver, 10).until(lambda current: "/auth/login" not in current.current_url)
    except TimeoutException:
        return "session-lost"
    return urlparse(driver.current_url).path or "/"


def run_pass(profiles: list[dict[str, object]], run_dir: str, keep_seconds: int) -> list[tuple[str, str]]:
    drivers: list[tuple[dict[str, object], webdriver.Chrome]] = []
    results: list[tuple[str, str]] = []
    try:
        for profile in profiles:
            name = str(profile["name"])
            slot_dir = Path(run_dir) / f"slot-{profile['slot']}"
            options = Options()
            options.add_argument(f"--user-data-dir={slot_dir}")
            options.add_argument("--disable-extensions")
            options.add_argument("--no-first-run")
            options.add_argument("--no-default-browser-check")
            try:
                driver = webdriver.Chrome(options=options)
                drivers.append((profile, driver))
                results.append((name, login(driver, profile)))
            except WebDriverException as exc:
                results.append((name, f"chrome-error:{type(exc).__name__}"))
    finally:
        if keep_seconds > 0 and drivers:
            time.sleep(keep_seconds)
        for _, driver in drivers:
            driver.quit()
    return results


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profiles-file", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--reuse-profiles-file", type=Path)
    parser.add_argument("--keep-seconds", type=int, default=5)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    profiles = load_profiles(args.profiles_file)
    replacement_profiles = load_profiles(args.reuse_profiles_file) if args.reuse_profiles_file else None
    if args.dry_run:
        summary = f"primera pasada: {len(profiles)} perfiles, slots {sorted(int(p['slot']) for p in profiles)}"
        if replacement_profiles:
            summary += f"; reutilización: {len(replacement_profiles)} perfiles, slots {sorted(int(p['slot']) for p in replacement_profiles)}"
        print(f"Configuración válida: {summary}")
        return

    results: list[tuple[str, str, str]] = []
    with TemporaryDirectory(prefix="tt-automation-", dir=ROOT / ".local") as run_dir:
        for name, result in run_pass(profiles, run_dir, args.keep_seconds):
            results.append(("primera", name, result))
        if replacement_profiles:
            for profile in profiles:
                shutil.rmtree(Path(run_dir) / f"slot-{profile['slot']}", ignore_errors=True)
            for name, result in run_pass(replacement_profiles, run_dir, args.keep_seconds):
                results.append(("reutilización", name, result))

    print("\nResultado:")
    for pass_name, name, result in results:
        print(f"- {pass_name} / {name}: {result}")
    if any(result in {"login-page", "session-lost"} or result.startswith("chrome-error:") for _, _, result in results):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
