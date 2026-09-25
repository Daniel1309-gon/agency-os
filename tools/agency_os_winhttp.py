"""Transporte HTTPS del agente sobre WinHTTP con certificado del almacen Windows.

El certificado no se exporta a PEM: WinHTTP recibe el contexto de certificado del
almacen (la clave puede vivir en el TPM y no ser exportable). La seleccion es
explicita por huella SHA-256; nunca se elige "el primero disponible".

Sin COM: se usa `ctypes` directo sobre winhttp.dll/crypt32.dll, que es seguro
entre hilos (cada peticion abre y cierra sus propios handles).

Uso:
    client = WinHttpClient.from_store('CURRENT_USER', '<sha256 hex>')
    status, body = client.request('POST', 'https://.../api/v1/x', {'content-type': 'application/json'}, b'{}')
"""

from __future__ import annotations

import ctypes
from ctypes import wintypes
from dataclasses import dataclass
from hashlib import sha256
from urllib.parse import urlsplit

WINHTTP_FLAG_SECURE = 0x00800000
WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY = 0x00000004
# winhttp.h: WINHTTP_OPTION_DISABLE_FEATURE = 63 y WINHTTP_DISABLE_REDIRECTS = 0x2.
# (WINHTTP_DISABLE_COOKIES es 0x1: con el par equivocado se desactivaban cookies,
# no redirecciones.)
WINHTTP_DISABLE_REDIRECTS = 0x00000002
WINHTTP_OPTION_DISABLE_FEATURE = 63
WINHTTP_OPTION_CLIENT_CERT_CONTEXT = 47
WINHTTP_OPTION_SECURITY_FLAGS = 31
SECURITY_FLAG_IGNORE_UNKNOWN_CA = 0x00000100
WINHTTP_QUERY_STATUS_CODE = 19
WINHTTP_QUERY_FLAG_NUMBER = 0x20000000
WINHTTP_NO_PROXY_NAME = None
WINHTTP_NO_PROXY_BYPASS = None
WINHTTP_NO_REFERER = None
WINHTTP_DEFAULT_ACCEPT_TYPES = None
WINHTTP_NO_ADDITIONAL_HEADERS = None
WINHTTP_NO_HEADER_INDEX = None
WINHTTP_NO_HEADER_NAME = None

CERT_STORE_PROV_SYSTEM_W = 10
CERT_STORE_PROV_SYSTEM = b"System"
CERT_SYSTEM_STORE_CURRENT_USER = 0x00010000
CERT_SYSTEM_STORE_LOCAL_MACHINE = 0x00020000
CERT_STORE_READONLY_FLAG = 0x00008000
X509_ASN_ENCODING = 0x00000001
PKCS_7_ASN_ENCODING = 0x00010000
CERT_ENCODING = X509_ASN_ENCODING | PKCS_7_ASN_ENCODING
ERROR_INSUFFICIENT_BUFFER = 122
STORE_NAME = "MY"
DEFAULT_TIMEOUT_MS = 15_000


class WinHttpError(RuntimeError):
    """Error saneado: nunca incluye encabezados, cuerpo ni la clave."""


class WinHttpCertificateNotFound(WinHttpError):
    pass


class _CERT_CONTEXT(ctypes.Structure):
    _fields_ = [
        ("dwCertEncodingType", wintypes.DWORD),
        ("pbCertEncoded", ctypes.POINTER(ctypes.c_ubyte)),
        ("cbCertEncoded", wintypes.DWORD),
        ("pCertInfo", ctypes.c_void_p),
        ("hCertStore", ctypes.c_void_p),
    ]


_PCERT_CONTEXT = ctypes.POINTER(_CERT_CONTEXT)


def _load_libraries() -> tuple[ctypes.WinDLL, ctypes.WinDLL]:
    if not hasattr(ctypes, "WinDLL"):
        raise WinHttpError("WinHTTP is only available on Windows")
    winhttp = ctypes.WinDLL("winhttp")
    crypt32 = ctypes.WinDLL("crypt32")
    winhttp.WinHttpOpen.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD]
    winhttp.WinHttpOpen.restype = ctypes.c_void_p
    winhttp.WinHttpConnect.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR, wintypes.WORD, wintypes.DWORD]
    winhttp.WinHttpConnect.restype = ctypes.c_void_p
    winhttp.WinHttpOpenRequest.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.LPCWSTR, ctypes.POINTER(wintypes.LPCWSTR), wintypes.DWORD]
    winhttp.WinHttpOpenRequest.restype = ctypes.c_void_p
    winhttp.WinHttpSetTimeouts.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int]
    winhttp.WinHttpSetTimeouts.restype = wintypes.BOOL
    winhttp.WinHttpSetOption.argtypes = [ctypes.c_void_p, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD]
    winhttp.WinHttpSetOption.restype = wintypes.BOOL
    winhttp.WinHttpSendRequest.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p]
    winhttp.WinHttpSendRequest.restype = wintypes.BOOL
    winhttp.WinHttpReceiveResponse.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    winhttp.WinHttpReceiveResponse.restype = wintypes.BOOL
    winhttp.WinHttpQueryHeaders.argtypes = [ctypes.c_void_p, wintypes.DWORD, wintypes.LPCWSTR, ctypes.c_void_p, ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p]
    winhttp.WinHttpQueryHeaders.restype = wintypes.BOOL
    winhttp.WinHttpReadData.argtypes = [ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]
    winhttp.WinHttpReadData.restype = wintypes.BOOL
    winhttp.WinHttpCloseHandle.argtypes = [ctypes.c_void_p]
    winhttp.WinHttpCloseHandle.restype = wintypes.BOOL
    crypt32.CertOpenStore.argtypes = [ctypes.c_char_p, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD, ctypes.c_void_p]
    crypt32.CertOpenStore.restype = ctypes.c_void_p
    crypt32.CertEnumCertificatesInStore.argtypes = [ctypes.c_void_p, _PCERT_CONTEXT]
    crypt32.CertEnumCertificatesInStore.restype = _PCERT_CONTEXT
    crypt32.CertFreeCertificateContext.argtypes = [_PCERT_CONTEXT]
    crypt32.CertFreeCertificateContext.restype = wintypes.BOOL
    crypt32.CertCloseStore.argtypes = [ctypes.c_void_p, wintypes.DWORD]
    crypt32.CertCloseStore.restype = wintypes.BOOL
    return winhttp, crypt32


@dataclass
class WinHttpClient:
    winhttp: ctypes.WinDLL
    crypt32: ctypes.WinDLL
    store: str
    fingerprint: str
    # Solo para la prueba local de redirecciones (servidor con certificado propio);
    # el agente siempre construye con `from_store`, que deja esto en False.
    allow_untrusted_server: bool = False

    @classmethod
    def from_store(cls, store: str, fingerprint: str) -> "WinHttpClient":
        normalized = fingerprint.strip().lower()
        if len(normalized) != 64 or any(character not in "0123456789abcdef" for character in normalized):
            raise WinHttpError("certificate fingerprint must be a lowercase SHA-256 hex digest")
        winhttp, crypt32 = _load_libraries()
        return cls(winhttp, crypt32, store, normalized)

    def request(
        self,
        method: str,
        url: str,
        headers: dict[str, str] | None = None,
        body: bytes | None = None,
        timeout_ms: int = DEFAULT_TIMEOUT_MS,
    ) -> tuple[int, bytes]:
        parts = urlsplit(url)
        if parts.scheme != "https" or not parts.hostname:
            raise WinHttpError("WinHTTP transport requires an https URL")
        session = self.winhttp.WinHttpOpen("AgencyOS-Local-Agent/0.1", WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0)
        if not session:
            raise WinHttpError("WinHttpOpen failed")
        connection = None
        request = None
        certificate = None
        try:
            self.winhttp.WinHttpSetTimeouts(session, timeout_ms, timeout_ms, timeout_ms, timeout_ms)
            connection = self.winhttp.WinHttpConnect(session, parts.hostname, parts.port or 443, 0)
            if not connection:
                raise WinHttpError("WinHttpConnect failed")
            path = parts.path or "/"
            if parts.query:
                path = f"{path}?{parts.query}"
            request = self.winhttp.WinHttpOpenRequest(connection, method, path, None, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, WINHTTP_FLAG_SECURE)
            if not request:
                raise WinHttpError("WinHttpOpenRequest failed")
            disabled = wintypes.DWORD(WINHTTP_DISABLE_REDIRECTS)
            if not self.winhttp.WinHttpSetOption(request, WINHTTP_OPTION_DISABLE_FEATURE, ctypes.byref(disabled), ctypes.sizeof(disabled)):
                raise WinHttpError("could not disable redirects")
            if self.allow_untrusted_server:
                security = wintypes.DWORD(SECURITY_FLAG_IGNORE_UNKNOWN_CA)
                self.winhttp.WinHttpSetOption(request, WINHTTP_OPTION_SECURITY_FLAGS, ctypes.byref(security), ctypes.sizeof(security))
            if self.fingerprint:
                certificate = self._find_certificate()
                if not self.winhttp.WinHttpSetOption(request, WINHTTP_OPTION_CLIENT_CERT_CONTEXT, ctypes.cast(certificate, ctypes.c_void_p), ctypes.sizeof(_CERT_CONTEXT)):
                    raise WinHttpError("could not select the client certificate")
            header_block = "".join(f"{name}: {value}\r\n" for name, value in (headers or {}).items())
            payload = body or b""
            payload_buffer = ctypes.create_string_buffer(payload) if payload else None
            if not self.winhttp.WinHttpSendRequest(
                request,
                header_block or WINHTTP_NO_ADDITIONAL_HEADERS,
                len(header_block) if header_block else 0,
                ctypes.cast(payload_buffer, ctypes.c_void_p) if payload_buffer else None,
                len(payload),
                len(payload),
                None,
            ):
                raise WinHttpError("WinHttpSendRequest failed")
            if not self.winhttp.WinHttpReceiveResponse(request, None):
                raise WinHttpError("WinHttpReceiveResponse failed")
            return self._status_code(request), self._read_body(request)
        finally:
            if certificate is not None:
                self.crypt32.CertFreeCertificateContext(certificate)
            for handle in (request, connection, session):
                if handle:
                    self.winhttp.WinHttpCloseHandle(handle)

    def _find_certificate(self) -> _PCERT_CONTEXT:
        store_location = CERT_SYSTEM_STORE_LOCAL_MACHINE if self.store.upper() == "LOCAL_MACHINE" else CERT_SYSTEM_STORE_CURRENT_USER
        store = self.crypt32.CertOpenStore(CERT_STORE_PROV_SYSTEM, 0, None, store_location | CERT_STORE_READONLY_FLAG, ctypes.c_wchar_p(STORE_NAME))
        if not store:
            raise WinHttpError("could not open the Windows certificate store")
        try:
            context = self.crypt32.CertEnumCertificatesInStore(store, None)
            while context:
                der = ctypes.string_at(context.contents.pbCertEncoded, context.contents.cbCertEncoded)
                if sha256(der).hexdigest() == self.fingerprint:
                    return context
                context = self.crypt32.CertEnumCertificatesInStore(store, context)
        finally:
            self.crypt32.CertCloseStore(store, 0)
        raise WinHttpCertificateNotFound("the configured certificate is not in the Windows store")

    def _status_code(self, request: ctypes.c_void_p) -> int:
        status = wintypes.DWORD(0)
        size = wintypes.DWORD(ctypes.sizeof(status))
        if not self.winhttp.WinHttpQueryHeaders(request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_NO_HEADER_NAME, ctypes.byref(status), ctypes.byref(size), WINHTTP_NO_HEADER_INDEX):
            raise WinHttpError("could not read the response status")
        return int(status.value)

    def _read_body(self, request: ctypes.c_void_p) -> bytes:
        chunks: list[bytes] = []
        buffer = ctypes.create_string_buffer(16_384)
        read = wintypes.DWORD(0)
        while True:
            if not self.winhttp.WinHttpReadData(request, buffer, ctypes.sizeof(buffer), ctypes.byref(read)):
                raise WinHttpError("could not read the response body")
            if read.value == 0:
                return b"".join(chunks)
            chunks.append(buffer.raw[: read.value])
