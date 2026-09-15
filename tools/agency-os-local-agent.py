# /// script
# requires-python = ">=3.11"
# dependencies = ["selenium>=4.20"]
# ///
"""Agente local: entrega temporal del vault y ciclo de vida de Chrome."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from selenium import webdriver
from selenium.common.exceptions import TimeoutException, WebDriverException
from selenium.webdriver.chrome.options import Options
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


def api_json(api_base: str, path: str, method: str, token: str, body: dict[str, object]) -> dict[str, object]:
    request = Request(
        f"{api_base.rstrip('/')}{path}",
        data=json.dumps(body).encode("utf-8"),
        method=method,
        headers={"content-type": "application/json", "x-device-token": token},
    )
    try:
        with urlopen(request, timeout=API_TIMEOUT_SECONDS) as response:
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
    def __init__(self, api_base: str, token_file: Path, slot_root: Path):
        self.api_base = api_base.rstrip("/")
        self.token_file = token_file.resolve()
        self.slot_root = slot_root.resolve()
        self.runtimes: dict[str, Runtime] = {}
        self.starting: set[str] = set()
        self.lock = threading.RLock()

    def token(self) -> str:
        token = self.token_file.read_text(encoding="utf-8").strip()
        if not token or len(token) > 512:
            raise RuntimeError("device token file is empty or invalid")
        return token

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
        token = self.token()
        results: list[dict[str, object]] = []
        for session in sessions:
            session_id = str(session["sessionId"])
            profile_id = str(session["profileId"])
            driver: webdriver.Chrome | None = None
            session_dir: Path | None = None
            stage = "credential"
            try:
                session_dir = self.session_dir(session_id, str(session["chromeProfileDir"]))
                credential = api_json(self.api_base, "/station/credential-claims", "POST", token, {"profileId": profile_id, "sessionId": session_id})
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
                driver = webdriver.Chrome(options=options)

                stage = "login"
                try:
                    self._login(driver, str(session["launchUrl"]), username, secret)
                finally:
                    secret = ""
                stage = "session"
                active = api_json(self.api_base, f"/station/sessions/{session_id}", "PATCH", token, {"status": "ACTIVE", "version": session_version})
                active_version = active.get("version")
                if not isinstance(active_version, int) or isinstance(active_version, bool) or active_version < 1:
                    raise RuntimeError("session response is invalid")
                permit = api_json(self.api_base, f"/station/sessions/{session_id}/heartbeat", "POST", token, {"version": active_version})
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
                self._mark_error(session_id, token, int(session["version"]), code, detail)
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
                response = api_json(self.api_base, f"/station/sessions/{runtime.session_id}/heartbeat", "POST", self.token(), {"version": runtime.version})
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
            api_json(self.api_base, f"/station/sessions/{session_id}/close", "POST", self.token(), {"version": version})
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
        confirmed = not confirm
        with runtime.close_lock:
            runtime.stop.set()
            if runtime.heartbeat and runtime.heartbeat is not threading.current_thread():
                runtime.heartbeat.join(timeout=API_TIMEOUT_SECONDS + 1)
            self.stop_driver(runtime.driver)
            self.cleanup(runtime.user_data_dir)
            if confirm:
                try:
                    api_json(self.api_base, f"/station/sessions/{session_id}/close", "POST", self.token(), {"version": runtime.version})
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

    def _mark_error(self, session_id: str, token: str, version: int, code: str, detail: str) -> None:
        try:
            api_json(self.api_base, f"/station/sessions/{session_id}", "PATCH", token, {"status": "ERROR", "version": version, "errorCode": code, "errorDetail": detail})
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
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-base-url", default="http://127.0.0.1:3000/api/v1")
    parser.add_argument("--web-origin", default="http://localhost:5173")
    parser.add_argument("--device-token-file", type=Path, required=False)
    parser.add_argument("--slot-root", type=Path, default=ROOT / ".local" / "agency-os-slots")
    parser.add_argument("--port", type=int, default=45831)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        sample = {"sessions": [{"profileId": "123e4567-e89b-12d3-a456-426614174000", "sessionId": "123e4567-e89b-12d3-a456-426614174001", "chromeProfileDir": "Profile 3", "launchUrl": LOGIN_URL, "version": 1}]}
        assert validate_sessions(sample)[0]["chromeProfileDir"] == "Profile 3"
        assert Agent("http://127.0.0.1:3000/api/v1", Path(".local/token"), Path(".local/slots")).slot_root.is_absolute()
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
        stale_close = Agent("http://127.0.0.1:3000/api/v1", Path(".local/token"), Path(".local/slots"))
        runtime = Runtime("123e4567-e89b-12d3-a456-426614174001", "123e4567-e89b-12d3-a456-426614174000", object(), Path(".local/slots/session"), 2, time.monotonic(), threading.Event())
        stale_close.runtimes[runtime.session_id] = runtime
        stale_close.close_runtime = lambda session_id, confirm: True  # type: ignore[method-assign]
        stale_close.close(runtime.session_id, 1)
        print("self-test: ok")
        return
    if not args.device_token_file:
        parser.error("--device-token-file es obligatorio")
    args.slot_root.mkdir(parents=True, exist_ok=True)
    agent = Agent(args.api_base_url, args.device_token_file, args.slot_root)
    server = Server(("127.0.0.1", args.port), agent, args.web_origin)
    print(f"Agency OS local agent listening on 127.0.0.1:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        agent.close_all()
        server.server_close()


if __name__ == "__main__":
    main()
