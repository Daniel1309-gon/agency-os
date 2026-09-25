; Instalador de estacion Windows de Agency OS (plan 2026-09-20, fase D2).
; Compilar con Inno Setup 6:
;   iscc /DExtensionId=<32 letras a-p> /DApiBaseUrl=https://erp.globalcompany.company/api/v1 ^
;        /DWebOrigin=https://erp.globalcompany.company tools\agent-build\installer.iss
;
; La huella del certificado es por PC y se pasa al instalar:
;   agency-os-station-setup.exe /CertSha256=<64 hex>

#ifndef ExtensionId
  #define ExtensionId "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
#endif
#ifndef ApiBaseUrl
  #define ApiBaseUrl "https://erp.globalcompany.company/api/v1"
#endif
#ifndef WebOrigin
  #define WebOrigin "https://erp.globalcompany.company"
#endif
#ifndef AgentSource
  #define AgentSource "dist\agency-os-agent"
#endif
#ifndef HelperSource
  #define HelperSource "..\..\local-helper\build\agency-os-helper.exe"
#endif

[Setup]
AppName=Agency OS Station
AppVersion=0.1.0
AppPublisher=Agency OS
DefaultDirName={autopf}\Agency OS
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=dist-installer
OutputBaseFilename=agency-os-station-setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=Agency OS Station

[Files]
Source: "{#AgentSource}\*"; DestDir: "{app}\agent"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#HelperSource}"; DestDir: "{app}"; DestName: "agency-os-helper.exe"; Flags: ignoreversion
Source: "..\..\deploy\production\station\install-station.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\deploy\production\station\uninstall-station.ps1"; DestDir: "{app}"; Flags: ignoreversion

[Run]
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\install-station.ps1"" -InstallDir ""{app}"" -ExtensionId ""{#ExtensionId}"" -ApiBaseUrl ""{#ApiBaseUrl}"" -WebOrigin ""{#WebOrigin}"" -CertSha256 ""{param:CertSha256}"""; \
  StatusMsg: "Configurando la estacion..."; Flags: runhidden waituntilterminated

[UninstallRun]
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\uninstall-station.ps1"" -InstallDir ""{app}"""; \
  RunOnceId: "AgencyOsStationCleanup"; Flags: runhidden waituntilterminated

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
function InitializeSetup(): Boolean;
begin
  if ExpandConstant('{param:CertSha256}') = '' then
  begin
    MsgBox('Falta la huella del certificado. Ejecute el instalador con /CertSha256=<huella SHA-256 en minusculas>.', mbError, MB_OK);
    Result := False;
    Exit;
  end;
  if Length(ExpandConstant('{param:CertSha256}')) <> 64 then
  begin
    MsgBox('La huella debe tener 64 caracteres hexadecimales en minusculas.', mbError, MB_OK);
    Result := False;
    Exit;
  end;
  Result := True;
end;
