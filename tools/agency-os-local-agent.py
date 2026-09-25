# /// script
# requires-python = ">=3.11"
# dependencies = ["selenium>=4.20", "certifi>=2024.2.2"]
# ///
"""Agente local: entrega temporal del vault y ciclo de vida de Chrome."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import shutil
import socket
import ssl
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import (
    HTTPRedirectHandler,
    HTTPSHandler,
    OpenerDirector,
    Request,
    build_opener,
    urlopen,
)

from selenium import webdriver
from selenium.common.exceptions import TimeoutException, WebDriverException
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait


ROOT = Path(__file__).resolve().parents[1]
UUID_RE = re.compile(r"^[0-9a-fA-F-]{36}$")
CHROME_PROFILE_RE = re.compile(r"^(Default|Profile [0-9]{1,3})$")
LOGIN_URL = "https://talkytimes.com/auth/login"
HEARTBEAT_SECONDS = 10
LOCAL_PERMIT_SECONDS = 30
API_TIMEOUT_SECONDS = 5
DEFAULT_CONFIG_PATH = Path(os.environ.get("PROGRAMDATA", r"C:\ProgramData")) / "AgencyOS" / "agent.json"
LOG_FILE: Path | None = None


def log(message: str) -> None:
    """El agente empaquetado corre sin consola; deja rastro en stderr y archivo."""
    line = f"{datetime.now().isoformat(timespec='seconds')} {message}"
    print(line, file=sys.stderr, flush=True)
    if LOG_FILE is not None:
        try:
            LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
            with LOG_FILE.open("a", encoding="utf-8") as handle:
                handle.write(line + "\n")
        except OSError:
            pass


def load_agent_config(path: Path) -> dict[str, object]:
    """Configuracion escrita por el instalador. Sin archivo, se usan los defaults."""
    if not path.is_file():
        return {}
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        raise SystemExit(f"Configuracion del agente invalida: {path}")
    if not isinstance(parsed, dict):
        raise SystemExit(f"Configuracion del agente invalida: {path}")
    return parsed


def config_url(value: object, name: str) -> str:
    if not isinstance(value, str) or not value:
        raise SystemExit(f"{name} invalido en la configuracion del agente")
    parsed = urlparse(value)
    if parsed.scheme != "https" and parsed.hostname not in ("localhost", "127.0.0.1"):
        raise SystemExit(f"{name} debe usar HTTPS fuera de localhost")
    return value


def config_fingerprint(value: object) -> str:
    if not isinstance(value, str) or len(value) != 64 or any(character not in "0123456789abcdef" for character in value):
        raise SystemExit("certSha256 debe ser una huella SHA-256 en minusculas")
    return value


def bundled_chromedriver() -> Path | None:
    """chromedriver.exe empaquetado junto al ejecutable o al script."""
    candidates = []
    bundle_dir = getattr(sys, "_MEIPASS", None)
    if bundle_dir:
        candidates.append(Path(bundle_dir) / "chromedriver.exe")
    candidates.append(Path(sys.executable).resolve().parent / "chromedriver.exe")
    candidates.append(Path(__file__).resolve().parent / "chromedriver.exe")
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return None


def process_name_for_pid(pid: int) -> str:
    result = subprocess.run(
        ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
        capture_output=True, text=True, check=False,
    )
    if result.returncode != 0 or not result.stdout.strip():
        return ""
    first = result.stdout.strip().splitlines()[0]
    parts = [part.strip('"') for part in first.split('","')]
    return parts[0].lower() if parts else ""


def local_agent_running(port: int) -> bool:
    """Windows permite dos binds al mismo puerto con SO_REUSEADDR; la sonda lo evita."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(1)
        return probe.connect_ex(("127.0.0.1", port)) == 0


JOB_OBJECT_HANDLE: int | None = None


def install_kill_on_close_job() -> bool:
    """KILL_ON_JOB_CLOSE sobre el agente: al morir, Windows termina su arbol.

    chromedriver y los Chrome de trabajo se lanzan despues de esta llamada, asi
    que heredan el job y no sobreviven a un cierre abrupto (crash, taskkill,
    cierre de sesion). El handle queda abierto a proposito: cerrarlo es lo que
    dispara la matanza. cleanup_orphans() sigue como red de seguridad para
    residuos de corridas anteriores al job.
    """
    if sys.platform != "win32":
        return False

    import ctypes
    from ctypes import wintypes

    class JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", ctypes.c_longlong),
            ("PerJobUserTimeLimit", ctypes.c_longlong),
            ("LimitFlags", wintypes.DWORD),
            ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t),
            ("ActiveProcessLimit", wintypes.DWORD),
            ("Affinity", ctypes.c_size_t),
            ("PriorityClass", wintypes.DWORD),
            ("SchedulingClass", wintypes.DWORD),
        ]

    class IO_COUNTERS(ctypes.Structure):
        _fields_ = [
            ("ReadOperationCount", ctypes.c_ulonglong),
            ("WriteOperationCount", ctypes.c_ulonglong),
            ("OtherOperationCount", ctypes.c_ulonglong),
            ("ReadTransferCount", ctypes.c_ulonglong),
            ("WriteTransferCount", ctypes.c_ulonglong),
            ("OtherTransferCount", ctypes.c_ulonglong),
        ]

    class JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("BasicLimitInformation", JOBOBJECT_BASIC_LIMIT_INFORMATION),
            ("IoInfo", IO_COUNTERS),
            ("ProcessMemoryLimit", ctypes.c_size_t),
            ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t),
            ("PeakJobMemoryUsed", ctypes.c_size_t),
        ]

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateJobObjectW.restype = wintypes.HANDLE
    kernel32.CreateJobObjectW.argtypes = (wintypes.LPVOID, wintypes.LPCWSTR)
    kernel32.SetInformationJobObject.argtypes = (wintypes.HANDLE, ctypes.c_int, wintypes.LPVOID, wintypes.DWORD)
    kernel32.AssignProcessToJobObject.argtypes = (wintypes.HANDLE, wintypes.HANDLE)
    kernel32.GetCurrentProcess.restype = wintypes.HANDLE

    job = kernel32.CreateJobObjectW(None, None)
    info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
    info.BasicLimitInformation.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    ok = (
        job
        and kernel32.SetInformationJobObject(job, 9, ctypes.byref(info), ctypes.sizeof(info))
        and kernel32.AssignProcessToJobObject(job, kernel32.GetCurrentProcess())
    )
    if not ok:
        log(f"job object no disponible (error {ctypes.get_last_error()})")
        return False
    global JOB_OBJECT_HANDLE
    JOB_OBJECT_HANDLE = job
    return True


def fingerprint_from_pem(path: Path) -> str:
    """SHA-256 del DER del certificado, para ensayos con PEM."""
    text = path.read_text(encoding="utf-8")
    begin, end = "-----BEGIN CERTIFICATE-----", "-----END CERTIFICATE-----"
    start, stop = text.find(begin), text.find(end)
    if start < 0 or stop <= start:
        raise ValueError("no es un certificado PEM")
    der = base64.b64decode("".join(text[start + len(begin):stop].split()), validate=True)
    if not der:
        raise ValueError("certificado PEM vacio")
    return hashlib.sha256(der).hexdigest()

PROTECT_FORM_SCRIPT = """
const hideEye = () => {
  for (const eye of document.querySelectorAll('svg#Eye, svg#EyeOff')) {
    eye.style.setProperty('display', 'none', 'important');
    eye.setAttribute('aria-hidden', 'true');
  }
  return {
    hasPassword: Boolean(document.querySelector('input[type="password"]')),
    hidden: [...document.querySelectorAll('svg#Eye, svg#EyeOff')].every((eye) => {
      const style = getComputedStyle(eye);
      return style.display === 'none' || style.visibility === 'hidden';
    }),
  };
};
hideEye();
if (!window.__agencyOsPasswordGuard) {
  window.__agencyOsPasswordGuard = new MutationObserver(hideEye);
  window.__agencyOsPasswordGuard.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['id'] });
}
return hideEye();
"""


def validate_sessions(payload: object) -> list[dict[str, object]]:
    if not isinstance(payload, dict) or not isinstance(payload.get("sessions"), list):
        raise ValueError("sessions debe ser una lista")
    sessions = payload["sessions"]
    if not 1 <= len(sessions) <= 8:
        raise ValueError("se permiten entre 1 y 8 sesiones")

    slots: set[str] = set()
    result: list[dict[str, object]] = []
    for session in sessions:
        if not isinstance(session, dict):
            raise ValueError("cada sesión debe ser un objeto")
        required = {"profileId", "sessionId", "chromeProfileDir", "launchUrl", "version"}
        if set(session) != required:
            raise ValueError("la sesión tiene campos inválidos")
        profile_id = session["profileId"]
        session_id = session["sessionId"]
        chrome_dir = session["chromeProfileDir"]
        launch_url = session["launchUrl"]
        version = session["version"]
        parsed = urlparse(launch_url) if isinstance(launch_url, str) else None
        if (
            not isinstance(profile_id, str) or not UUID_RE.fullmatch(profile_id)
            or not isinstance(session_id, str) or not UUID_RE.fullmatch(session_id)
            or not isinstance(chrome_dir, str) or not CHROME_PROFILE_RE.fullmatch(chrome_dir)
            or not isinstance(launch_url, str) or parsed is None
            or parsed.scheme != "https" or parsed.hostname != "talkytimes.com"
            or not parsed.path.startswith("/auth/login")
            or not isinstance(version, int) or isinstance(version, bool) or version < 1
        ):
            raise ValueError("datos de sesión inválidos")
        if chrome_dir in slots:
            raise ValueError("un slot Chrome no puede usarse dos veces en la misma petición")
        slots.add(chrome_dir)
        result.append({
            "profileId": profile_id,
            "sessionId": session_id,
            "chromeProfileDir": chrome_dir,
            "launchUrl": launch_url,
            "version": version,
        })
    return result


class ApiFailure(RuntimeError):
    def __init__(self, status: int | str):
        self.status = status
        super().__init__(f"API request failed: {status}")


class NoRedirectHandler(HTTPRedirectHandler):
    """Nunca reenvía una petición (ni el token de dispositivo) a otro destino."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[override]
        return None


def default_https_context() -> ssl.SSLContext:
    """Contexto por defecto con un bundle de CAs actualizado.

    En Windows, OpenSSL toma el almacén del sistema, que puede conservar
    certificados intermedios vencidos (por ejemplo el ISRG Root X2 cruzado de
    Let's Encrypt) y hacer fallar cadenas válidas. `certifi` evita ese problema
    sin desactivar la verificación. Si no está disponible, se usa el store del
    sistema.
    """
    try:
        import certifi
    except ImportError:
        return ssl.create_default_context()
    return ssl.create_default_context(cafile=certifi.where())


def build_http_opener(
    client_cert: Path | None = None,
    client_key: Path | None = None,
    ca_file: Path | None = None,
) -> OpenerDirector:
    """Opener HTTPS con validación de servidor y, si se pide, certificado de cliente.

    `ssl.create_default_context()` conserva la verificación de certificado y
    hostname del servidor. El certificado y la clave deben ir juntos.
    """
    if (client_cert is None) != (client_key is None):
        raise ValueError("client certificate and key must be provided together")
    handlers: list[object] = [NoRedirectHandler()]
    if client_cert is not None or ca_file is not None:
        context = ssl.create_default_context(cafile=str(ca_file)) if ca_file is not None else default_https_context()
        if client_cert is not None and client_key is not None:
            context.load_cert_chain(certfile=str(client_cert), keyfile=str(client_key))
        handlers.append(HTTPSHandler(context=context))
    return build_opener(*handlers)


def api_json(
    api_base: str,
    path: str,
    method: str,
    body: dict[str, object],
    opener: OpenerDirector | None = None,
    winhttp: object | None = None,
) -> dict[str, object]:
    url = f"{api_base.rstrip('/')}{path}"
    payload = json.dumps(body).encode("utf-8")
    headers = {
        "content-type": "application/json",
        # Cloudflare bloquea clientes sin firma de navegador (error 1010);
        # el agente se identifica con su propio nombre.
        "user-agent": "AgencyOS-Local-Agent/0.1",
    }
    if winhttp is not None:
        # Certificado del almacen Windows (clave no exportable) via WinHTTP.
        try:
            status, raw = winhttp.request(method, url, headers, payload, API_TIMEOUT_SECONDS * 1000)
        except Exception:  # noqa: BLE001 - el error saneado del transporte no se propaga
            raise ApiFailure("network") from None
        if status >= 400:
            raise ApiFailure(status)
        try:
            data = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            raise ApiFailure("invalid-response") from None
        if not isinstance(data, dict):
            raise ApiFailure("invalid-response")
        return data
    request = Request(url, data=payload, method=method, headers=headers)
    try:
        open_request = opener.open if opener is not None else urlopen
        with open_request(request, timeout=API_TIMEOUT_SECONDS) as response:
            data = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        raise ApiFailure(exc.code) from None
    except (URLError, TimeoutError, json.JSONDecodeError):
        raise ApiFailure("network") from None
    if not isinstance(data, dict):
        raise ApiFailure("invalid-response")
    return data


def safe_error(exc: BaseException, stage: str) -> tuple[str, str]:
    if isinstance(exc, ApiFailure):
        if exc.status in (401, 403, 404):
            return "SESSION_REVOKED", "La sesión dejó de estar autorizada."
        if exc.status == 409:
            return "SESSION_CHANGED", "La sesión cambió en el servidor."
        return "NETWORK_ERROR", "No se pudo validar la sesión con el servidor."
    if isinstance(exc, TimeoutException):
        return ("LOGIN_REJECTED", "TalkyTimes no confirmó el inicio de sesión.") if stage == "login" else ("CHROME_START_FAILED", "Chrome no respondió a tiempo.")
    if isinstance(exc, WebDriverException):
        return "CHROME_START_FAILED", "Chrome no pudo iniciar la sesión aislada."
    if stage == "credential":
        return "CREDENTIAL_UNAVAILABLE", "No se pudo obtener la credencial del vault."
    return "LOGIN_REJECTED", "TalkyTimes rechazó o no confirmó el inicio de sesión."


@dataclass
class Runtime:
    session_id: str
    profile_id: str
    driver: webdriver.Chrome
    user_data_dir: Path
    version: int
    permit_deadline: float
    stop: threading.Event
    heartbeat: threading.Thread | None = None
    close_lock: threading.Lock = field(default_factory=threading.Lock)


class Agent:
    def __init__(self, api_base: str, slot_root: Path, http_opener: OpenerDirector | None = None, winhttp: object | None = None, chromedriver_path: Path | None = None):
        self.api_base = api_base.rstrip("/")
        self.slot_root = slot_root.resolve()
        self.http_opener = http_opener
        self.winhttp = winhttp
        self.chromedriver_path = chromedriver_path
        self.runtimes: dict[str, Runtime] = {}
        self.starting: set[str] = set()
        self.lock = threading.RLock()
        self.state_file = self.slot_root / "agent-state.json"
        if install_kill_on_close_job():
            log("job object activo: chromedriver y Chrome mueren con el agente")
        self.cleanup_orphans()

    def _load_state(self) -> list[dict[str, object]]:
        try:
            parsed = json.loads(self.state_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return []
        return [entry for entry in parsed if isinstance(entry, dict)] if isinstance(parsed, list) else []

    def _save_state(self) -> None:
        entries = [entry for entry in self._load_state() if str(entry.get("sessionId")) in self.runtimes]
        try:
            self.state_file.parent.mkdir(parents=True, exist_ok=True)
            self.state_file.write_text(json.dumps(entries), encoding="utf-8")
        except OSError:
            pass

    def _record_driver(self, session_id: str, driver: webdriver.Chrome) -> None:
        pid = self._driver_pid(driver)
        if not pid:
            return
        entries = [entry for entry in self._load_state() if entry.get("sessionId") != session_id]
        entries.append({"sessionId": session_id, "driverPid": pid})
        try:
            self.state_file.parent.mkdir(parents=True, exist_ok=True)
            self.state_file.write_text(json.dumps(entries), encoding="utf-8")
        except OSError:
            pass

    @staticmethod
    def _driver_pid(driver: webdriver.Chrome) -> int | None:
        process = getattr(getattr(driver, "service", None), "process", None)
        pid = getattr(process, "pid", None)
        return pid if isinstance(pid, int) else None

    def cleanup_orphans(self) -> None:
        """Cierra chromedrivers que quedaron vivos de una corrida anterior.

        El agente muere y sus Chrome de trabajo no deben quedar abiertos; solo se
        termina un PID registrado por el propio agente y cuyo proceso siga siendo
        chromedriver.exe, para no tocar Chrome personal ni PIDs reutilizados.
        """
        entries = self._load_state()
        if not entries:
            return
        for entry in entries:
            pid = entry.get("driverPid")
            if isinstance(pid, int) and process_name_for_pid(pid) == "chromedriver.exe":
                subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, check=False)
                log(f"huerfano cerrado: chromedriver pid {pid}")
        try:
            self.state_file.write_text("[]", encoding="utf-8")
        except OSError:
            pass

    def start(self, sessions: list[dict[str, object]]) -> list[dict[str, object]]:
        with self.lock:
            pending = []
            results = []
            for session in sessions:
                session_id = str(session["sessionId"])
                if session_id in self.runtimes or session_id in self.starting:
                    results.append({"profileId": session["profileId"], "ok": False, "reason": "SESSION_ALREADY_OPEN"})
                else:
                    self.starting.add(session_id)
                    pending.append(session)
        try:
            results.extend(self._start(pending))
        finally:
            with self.lock:
                self.starting.difference_update(str(session["sessionId"]) for session in pending)
        return results

    def _start(self, sessions: list[dict[str, object]]) -> list[dict[str, object]]:
        results: list[dict[str, object]] = []
        for session in sessions:
            session_id = str(session["sessionId"])
            profile_id = str(session["profileId"])
            driver: webdriver.Chrome | None = None
            session_dir: Path | None = None
            stage = "credential"
            try:
                session_dir = self.session_dir(session_id, str(session["chromeProfileDir"]))
                credential = api_json(self.api_base, "/station/credential-claims", "POST", {"profileId": profile_id, "sessionId": session_id}, self.http_opener, self.winhttp)
                username = credential.get("username")
                secret = credential.get("secret")
                session_version = credential.get("sessionVersion")
                if (
                    not isinstance(username, str)
                    or not isinstance(secret, str)
                    or not isinstance(session_version, int)
                    or isinstance(session_version, bool)
                    or session_version < 1
                ):
                    raise RuntimeError("credential response is invalid")

                stage = "chrome"
                session_dir.mkdir(parents=True, exist_ok=False)
                options = Options()
                options.add_argument(f"--user-data-dir={session_dir}")
                options.add_argument("--disable-extensions")
                options.add_argument("--no-first-run")
                options.add_argument("--no-default-browser-check")
                options.add_experimental_option("prefs", {
                    "credentials_enable_service": False,
                    "profile.password_manager_enabled": False,
                    "profile.password_manager_leak_detection": False,
                })
                service = Service(executable_path=str(self.chromedriver_path)) if self.chromedriver_path else None
                driver = webdriver.Chrome(options=options, service=service) if service else webdriver.Chrome(options=options)
                self._record_driver(session_id, driver)

                stage = "login"
                try:
                    self._login(driver, str(session["launchUrl"]), username, secret)
                finally:
                    secret = ""
                stage = "session"
                active = api_json(self.api_base, f"/station/sessions/{session_id}", "PATCH", {"status": "ACTIVE", "version": session_version}, self.http_opener, self.winhttp)
                active_version = active.get("version")
                if not isinstance(active_version, int) or isinstance(active_version, bool) or active_version < 1:
                    raise RuntimeError("session response is invalid")
                permit = api_json(self.api_base, f"/station/sessions/{session_id}/heartbeat", "POST", {"version": active_version}, self.http_opener, self.winhttp)
                if permit.get("decision") != "CONTINUE" or not isinstance(permit.get("version"), int):
                    raise ApiFailure(403)
                runtime = Runtime(session_id, profile_id, driver, session_dir, int(permit["version"]), self.permit_deadline(permit), threading.Event())
                runtime.heartbeat = threading.Thread(target=self.heartbeat_loop, args=(runtime,), name=f"heartbeat-{session_id[:8]}", daemon=True)
                self.runtimes[session_id] = runtime
                runtime.heartbeat.start()
                results.append({"profileId": profile_id, "ok": True})
            except (RuntimeError, ApiFailure, OSError, TimeoutException, WebDriverException) as exc:
                if driver is not None:
                    self.stop_driver(driver)
                code, detail = safe_error(exc, stage)
                print(f"session {session_id} failed: {code}", flush=True)
                self._mark_error(session_id, int(session["version"]), code, detail)
                if session_dir is not None:
                    self.cleanup(session_dir)
                results.append({"profileId": profile_id, "ok": False, "reason": code})
        return results

    def session_dir(self, session_id: str, chrome_dir: str) -> Path:
        # ponytail: one directory per session; never reuse browser state.
        slot = self.slot_root / f"slot-{chrome_dir.replace(' ', '_')}"
        slot.mkdir(parents=True, exist_ok=True)
        resolved_slot = slot.resolve()
        if slot.is_symlink() or resolved_slot != slot.absolute() or not resolved_slot.is_relative_to(self.slot_root):
            raise RuntimeError("unsafe session root")
        session_dir = slot / session_id
        if session_dir.exists() or session_dir.is_symlink():
            raise RuntimeError("session directory already exists")
        return session_dir

    @staticmethod
    def _login(driver: webdriver.Chrome, launch_url: str, username: str, secret: str) -> None:
        wait = WebDriverWait(driver, 20)
        driver.get(launch_url)
        password = wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, 'input[type="password"]')))
        protection = driver.execute_script(PROTECT_FORM_SCRIPT)
        if not isinstance(protection, dict) or protection.get("hasPassword") is not True or protection.get("hidden") is not True:
            raise RuntimeError("password form is not protected")
        email = wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, 'input[type="email"]')))
        email.send_keys(username)
        password.send_keys(secret)
        driver.execute_script(PROTECT_FORM_SCRIPT)
        try:
            submit = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, 'button[title="Submit"]')))
        except TimeoutException:
            submit = wait.until(EC.element_to_be_clickable((By.XPATH, '//button[normalize-space(.)="Log in"]')))
        submit.click()
        wait.until(lambda current: "/auth/login" not in current.current_url)
        driver.get("https://talkytimes.com/search/all")
        wait.until(lambda current: current.current_url.startswith("https://talkytimes.com/search/all") and not current.find_elements(By.CSS_SELECTOR, 'input[type="password"]'))

    def heartbeat_loop(self, runtime: Runtime) -> None:
        while not runtime.stop.wait(HEARTBEAT_SECONDS):
            started = time.monotonic()
            try:
                response = api_json(self.api_base, f"/station/sessions/{runtime.session_id}/heartbeat", "POST", {"version": runtime.version}, self.http_opener, self.winhttp)
                elapsed = time.monotonic() - started
                if response.get("decision") != "CONTINUE" or not isinstance(response.get("version"), int):
                    self.close_runtime(runtime.session_id, confirm=False)
                    return
                runtime.version = int(response["version"])
                runtime.permit_deadline = self.permit_deadline(response, elapsed)
            except ApiFailure as exc:
                if exc.status in (401, 403, 404, 409) or time.monotonic() >= runtime.permit_deadline:
                    self.close_runtime(runtime.session_id, confirm=True)
                    return
            except (RuntimeError, OSError):
                if time.monotonic() >= runtime.permit_deadline:
                    self.close_runtime(runtime.session_id, confirm=True)
                    return

    @staticmethod
    def permit_deadline(response: dict[str, object], request_elapsed: float = 0) -> float:
        server_time = response.get("serverTime")
        permit_until = response.get("permitUntil")
        if not isinstance(server_time, str) or not isinstance(permit_until, str):
            raise RuntimeError("heartbeat response is invalid")
        server = datetime.fromisoformat(server_time.replace("Z", "+00:00"))
        until = datetime.fromisoformat(permit_until.replace("Z", "+00:00"))
        return time.monotonic() + max(0.0, min(LOCAL_PERMIT_SECONDS, (until - server).total_seconds() - request_elapsed))

    def focus(self, session_id: str, version: int) -> None:
        with self.lock:
            runtime = self.runtimes.get(session_id)
            if runtime is None:
                raise RuntimeError("SESSION_NOT_OPEN")
        with runtime.close_lock:
            runtime.driver.switch_to.window(runtime.driver.current_window_handle)
            runtime.driver.execute_script("window.focus();")

    def close(self, session_id: str, version: int) -> None:
        with self.lock:
            runtime = self.runtimes.get(session_id)
        if runtime is None:
            api_json(self.api_base, f"/station/sessions/{session_id}/close", "POST", {"version": version}, self.http_opener, self.winhttp)
            return
        # La versión de la web puede quedar atrasada por los heartbeats. El
        # agente conserva la versión autoritativa de su sesión local.
        if not self.close_runtime(session_id, confirm=True):
            raise RuntimeError("CLOSE_UNCONFIRMED")

    def close_runtime(self, session_id: str, confirm: bool) -> bool:
        with self.lock:
            runtime = self.runtimes.pop(session_id, None)
        if runtime is None:
            return False
        self._save_state()
        confirmed = not confirm
        with runtime.close_lock:
            runtime.stop.set()
            if runtime.heartbeat and runtime.heartbeat is not threading.current_thread():
                runtime.heartbeat.join(timeout=API_TIMEOUT_SECONDS + 1)
            self.stop_driver(runtime.driver)
            self.cleanup(runtime.user_data_dir)
            if confirm:
                try:
                    api_json(self.api_base, f"/station/sessions/{session_id}/close", "POST", {"version": runtime.version}, self.http_opener, self.winhttp)
                    confirmed = True
                except (ApiFailure, RuntimeError, OSError):
                    pass
        return confirmed

    @staticmethod
    def stop_driver(driver: webdriver.Chrome) -> None:
        service = getattr(driver, "service", None)
        process = getattr(service, "process", None)
        pid = getattr(process, "pid", None)
        finished = threading.Event()

        def quit_driver() -> None:
            try:
                driver.quit()
            except Exception:
                pass
            finally:
                finished.set()

        threading.Thread(target=quit_driver, name="chrome-quit", daemon=True).start()
        finished.wait(timeout=2)
        if not finished.is_set() and pid and os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, check=False)

    def cleanup(self, path: Path) -> None:
        root = self.slot_root
        try:
            if path.exists() and path.is_dir() and path.resolve().is_relative_to(root):
                shutil.rmtree(path)
        except OSError:
            try:
                if path.resolve().is_relative_to(root):
                    (path / ".cleanup-pending").write_text("pending", encoding="ascii")
            except OSError:
                pass

    def _mark_error(self, session_id: str, version: int, code: str, detail: str) -> None:
        try:
            api_json(self.api_base, f"/station/sessions/{session_id}", "PATCH", {"status": "ERROR", "version": version, "errorCode": code, "errorDetail": detail}, self.http_opener, self.winhttp)
        except (ApiFailure, RuntimeError, OSError):
            pass

    def close_all(self) -> None:
        for session_id in list(self.runtimes):
            self.close_runtime(session_id, confirm=True)


class Server(ThreadingHTTPServer):
    def __init__(self, address: tuple[str, int], agent: Agent, web_origin: str):
        super().__init__(address, Handler)
        self.agent = agent
        self.web_origin = web_origin.rstrip("/")


class Handler(BaseHTTPRequestHandler):
    server: Server

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def _cors_allowed(self) -> bool:
        return self.headers.get("origin") == self.server.web_origin

    def _json(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        if self._cors_allowed():
            self.send_header("access-control-allow-origin", self.server.web_origin)
            self.send_header("vary", "Origin")
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        if not self._cors_allowed():
            self._json(403, {"ok": False, "error": "origin-not-allowed"})
            return
        self.send_response(204)
        self.send_header("access-control-allow-origin", self.server.web_origin)
        self.send_header("access-control-allow-methods", "GET, POST, OPTIONS")
        self.send_header("access-control-allow-headers", "content-type")
        self.send_header("vary", "Origin")
        self.end_headers()

    def read_payload(self) -> dict[str, object]:
        length = int(self.headers.get("content-length", "0"))
        if length < 1 or length > 64 * 1024:
            raise ValueError("body inválido")
        payload = json.loads(self.rfile.read(length).decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("body inválido")
        return payload

    def do_GET(self) -> None:
        if self.path != "/health":
            self._json(404, {"ok": False, "error": "not-found"})
            return
        self._json(200, {"ok": True, "mode": "automated-chrome"})

    def do_POST(self) -> None:
        if not self._cors_allowed():
            self._json(403, {"ok": False, "error": "origin-not-allowed"})
            return
        try:
            payload = self.read_payload()
            if self.path == "/v1/start":
                sessions = validate_sessions(payload)
                results = self.server.agent.start(sessions)
                self._json(200, {"ok": all(item["ok"] for item in results), "results": results})
                return
            session_id = payload.get("sessionId")
            if not isinstance(session_id, str) or not UUID_RE.fullmatch(session_id):
                raise ValueError("sessionId inválido")
            if self.path == "/v1/focus":
                version = payload.get("version")
                if not isinstance(version, int) or isinstance(version, bool) or version < 1:
                    raise ValueError("version inválida")
                self.server.agent.focus(session_id, version)
                self._json(200, {"ok": True})
                return
            if self.path == "/v1/close":
                version = payload.get("version")
                if not isinstance(version, int) or isinstance(version, bool) or version < 1:
                    raise ValueError("version inválida")
                self.server.agent.close(session_id, version)
                self._json(200, {"ok": True})
                return
            self._json(404, {"ok": False, "error": "not-found"})
        except (ValueError, json.JSONDecodeError, RuntimeError):
            self._json(400, {"ok": False, "error": "agent-request-rejected"})
        except Exception:
            self._json(500, {"ok": False, "error": "agent-failed"})


def main() -> None:
    global LOG_FILE
    config_path = Path(os.environ.get("AGENCY_OS_AGENT_CONFIG", str(DEFAULT_CONFIG_PATH)))
    config = load_agent_config(config_path)

    parser = argparse.ArgumentParser()
    parser.add_argument("--config-file", type=Path, default=config_path, help="Configuracion del instalador (por defecto %%ProgramData%%\\AgencyOS\\agent.json)")
    parser.add_argument("--api-base-url", default=str(config.get("apiBaseUrl", "http://127.0.0.1:3000/api/v1")))
    parser.add_argument("--web-origin", default=str(config.get("webOrigin", "http://localhost:5173")))
    parser.add_argument("--client-cert-file", type=Path, help="Certificado de cliente mTLS (PEM); solo para ensayos")
    parser.add_argument("--client-key-file", type=Path, help="Clave privada del certificado de cliente (PEM); solo para ensayos")
    parser.add_argument("--winhttp-cert-sha256", default=(str(config["certSha256"]) if config.get("certSha256") else None), help="Huella SHA-256 del certificado en el almacen Windows (produccion; clave no exportable)")
    parser.add_argument("--winhttp-store", choices=["CURRENT_USER", "LOCAL_MACHINE"], default=str(config.get("certStore", "CURRENT_USER")))
    parser.add_argument("--slot-root", type=Path, default=Path(str(config.get("slotRoot", ROOT / ".local" / "agency-os-slots"))))
    parser.add_argument("--port", type=int, default=int(str(config.get("port", 45831))))
    parser.add_argument("--log-file", type=Path, default=(Path(str(config["logFile"])) if config.get("logFile") else None))
    parser.add_argument("--enroll-code-file", type=Path, help="Codigo de enrolamiento de un solo uso; enrola la PC y termina")
    parser.add_argument("--enroll-label", default=str(config.get("label", "")))
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if config:
        args.api_base_url = config_url(args.api_base_url, "apiBaseUrl")
        args.web_origin = config_url(args.web_origin, "webOrigin")
        if args.winhttp_cert_sha256:
            args.winhttp_cert_sha256 = config_fingerprint(args.winhttp_cert_sha256)
        if not 1 <= args.port <= 65535:
            raise SystemExit("port invalido en la configuracion del agente")
    LOG_FILE = args.log_file

    if args.self_test:
        sample = {"sessions": [{"profileId": "123e4567-e89b-12d3-a456-426614174000", "sessionId": "123e4567-e89b-12d3-a456-426614174001", "chromeProfileDir": "Profile 3", "launchUrl": LOGIN_URL, "version": 1}]}
        assert validate_sessions(sample)[0]["chromeProfileDir"] == "Profile 3"
        assert Agent("http://127.0.0.1:3000/api/v1", Path(".local/slots")).slot_root.is_absolute()
        try:
            validate_sessions({"sessions": [{**sample["sessions"][0], "chromeProfileDir": "..\\Secrets"}]})
        except ValueError:
            pass
        else:
            raise AssertionError("unsafe Chrome profile accepted")
        try:
            validate_sessions({"sessions": [{**sample["sessions"][0], "version": True}]})
        except ValueError:
            pass
        else:
            raise AssertionError("boolean session version accepted")
        try:
            build_http_opener(Path("solo-cert.pem"), None)
        except ValueError:
            pass
        else:
            raise AssertionError("partial mTLS configuration accepted")
        stale_close = Agent("http://127.0.0.1:3000/api/v1", Path(".local/slots"))
        runtime = Runtime("123e4567-e89b-12d3-a456-426614174001", "123e4567-e89b-12d3-a456-426614174000", object(), Path(".local/slots/session"), 2, time.monotonic(), threading.Event())
        stale_close.runtimes[runtime.session_id] = runtime
        stale_close.close_runtime = lambda session_id, confirm: True  # type: ignore[method-assign]
        stale_close.close(runtime.session_id, 1)
        # Estado de huerfanos: se escribe, sobrevive y se limpia aunque el archivo
        # tenga un PID que ya no existe.
        import tempfile
        with tempfile.TemporaryDirectory() as scratch:
            orphan = Agent("http://127.0.0.1:3000/api/v1", Path(scratch) / "slots")
            orphan.slot_root.mkdir(parents=True, exist_ok=True)
            orphan.state_file.write_text(json.dumps([{"sessionId": "s", "driverPid": 999999}]), encoding="utf-8")
            assert len(orphan._load_state()) == 1
            orphan.cleanup_orphans()
            assert orphan._load_state() == []
        print("self-test: ok")
        return

    if (args.client_cert_file is None) != (args.client_key_file is None):
        parser.error("--client-cert-file y --client-key-file deben usarse juntos")
    if args.winhttp_cert_sha256 and (args.client_cert_file or args.client_key_file):
        parser.error("use --winhttp-cert-sha256 o el par PEM, no ambos")
    opener = None
    winhttp = None
    if args.winhttp_cert_sha256:
        # Produccion: la clave vive en el almacen (TPM cuando esta disponible) y
        # WinHTTP recibe el contexto del certificado, nunca un archivo exportado.
        try:
            from agency_os_winhttp import WinHttpClient
        except ImportError:
            sys.path.insert(0, str(Path(__file__).resolve().parent))
            from agency_os_winhttp import WinHttpClient
        try:
            winhttp = WinHttpClient.from_store(args.winhttp_store, args.winhttp_cert_sha256)
        except RuntimeError:
            parser.error("La huella de certificado no es valida o el transporte WinHTTP no esta disponible")
    if args.client_cert_file is not None and args.client_key_file is not None:
        for path, label in ((args.client_cert_file, "certificado"), (args.client_key_file, "clave")):
            if not path.is_file():
                parser.error(f"El archivo de {label} de cliente no existe: {path}")
        try:
            opener = build_http_opener(args.client_cert_file, args.client_key_file)
        except (ssl.SSLError, OSError, ValueError):
            parser.error("El certificado y la clave de cliente no forman un par válido")
    if args.enroll_code_file is not None:
        # Un solo uso: el administrador crea el dispositivo y entrega el codigo;
        # esta PC lo canjea presentando su propio certificado (WAF + mTLS).
        if not (winhttp or opener):
            parser.error("el enrolamiento requiere el certificado de la PC")
        fingerprint = args.winhttp_cert_sha256
        if not fingerprint and args.client_cert_file is not None:
            try:
                fingerprint = fingerprint_from_pem(args.client_cert_file)
            except (OSError, ValueError):
                parser.error("No se pudo calcular la huella del certificado PEM")
        if not fingerprint:
            parser.error("Falta la huella del certificado para enrolar")
        if not args.enroll_code_file.is_file():
            parser.error(f"No existe el archivo de codigo: {args.enroll_code_file}")
        code = args.enroll_code_file.read_text(encoding="utf-8").strip()
        if len(code) < 20 or len(code) > 128:
            parser.error("El codigo de enrolamiento es invalido")
        label = args.enroll_label or socket.gethostname()
        result = api_json(args.api_base_url, "/devices/enroll", "POST", {
            "code": code,
            "hostname": socket.gethostname(),
            "label": label,
            "certFingerprint": fingerprint,
        }, opener, winhttp)
        log(f"device enrolled: {result.get('deviceId')}")
        return
    args.slot_root.mkdir(parents=True, exist_ok=True)
    if local_agent_running(args.port):
        # Autostart: si ya hay una instancia escuchando, esta segunda sale en paz.
        log(f"el agente ya esta escuchando en 127.0.0.1:{args.port}")
        return
    driver_path = bundled_chromedriver()
    agent = Agent(args.api_base_url, args.slot_root, opener, winhttp, driver_path)
    try:
        server = Server(("127.0.0.1", args.port), agent, args.web_origin)
    except OSError:
        log(f"no se pudo escuchar en 127.0.0.1:{args.port}")
        return
    log(f"Agency OS local agent listening on 127.0.0.1:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        agent.close_all()
        server.server_close()


if __name__ == "__main__":
    main()
