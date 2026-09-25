# -*- mode: python ; coding: utf-8 -*-
# Empaqueta el agente local (tools/agency-os-local-agent.py) para Windows x64.
# Build: tools/agent-build/build-agent.ps1 (uv, versiones fijadas en el script).
# Onedir: arranca mas rapido que onefile y el instalador lo copia tal cual.
import os
from PyInstaller.utils.hooks import collect_submodules

binaries = []
# Si hay un chromedriver.exe junto al spec, se empaqueta y el agente no depende
# de que Selenium Manager lo descargue en cada PC de oficina.
driver = os.path.join(SPECPATH, "chromedriver.exe")
if os.path.isfile(driver):
    binaries.append((driver, "."))

hiddenimports = collect_submodules("selenium")

a = Analysis(
    [os.path.join(SPECPATH, "..", "agency-os-local-agent.py")],
    pathex=[],
    binaries=binaries,
    datas=[],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "numpy", "pandas", "pytest"],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="agency-os-agent",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="agency-os-agent",
)
