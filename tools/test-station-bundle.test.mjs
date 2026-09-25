import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

async function source(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

test('station installer uses exact hosts markers, Enterprise policy, Native Messaging and restricted token storage', async () => {
  const install = await source('../deploy/station-e2e/station/install.ps1');
  assert.match(install, /Parameter\(Mandatory = \$true\).*ServerIp/s);
  assert.match(install, /StationIpCidr/);
  assert.match(install, /EnrollmentCode/);
  assert.match(install, /ExtensionInstallForcelist/);
  assert.match(install, /https:\/\/app\.agency-os\.test\/extension\/update\.xml/);
  assert.match(install, /NativeMessagingHosts/);
  assert.match(install, /C:\\ProgramData\\AgencyOS/);
  assert.match(install, /BEGIN Agency OS Station E2E/);
  assert.match(install, /icacls\.exe/);
  assert.doesNotMatch(install, /Write-(?:Host|Output).*(?:EnrollmentCode|deviceToken)/i);
});

test('uninstaller revokes first, removes only recorded artifacts and preserves Chrome profiles', async () => {
  const uninstall = await source('../deploy/station-e2e/station/uninstall.ps1');
  const revokeAt = uninstall.indexOf('/revoke');
  const cleanupAt = uninstall.indexOf('Remove-Item');
  assert.ok(revokeAt >= 0 && cleanupAt > revokeAt, 'remote revocation must precede cleanup');
  assert.match(uninstall, /forcelistValueName/i);
  assert.match(uninstall, /BEGIN Agency OS Station E2E/);
  assert.match(uninstall, /perfiles de Chrome se conservaron/i);
  assert.doesNotMatch(uninstall, /User Data|Profile \*|--volumes|down -v/);
});

test('bundle builder emits checksums and provenance without copying private or secret material', async () => {
  const build = await source('../deploy/station-e2e/build-bundle.ps1');
  assert.match(build, /GOOS.*windows/s);
  assert.match(build, /GOARCH.*amd64/s);
  // The Go module lives in local-helper/, not at the repository root.
  assert.match(build, /go build -C \(Join-Path \$ProjectRoot 'local-helper'\)/);
  assert.match(build, /git.*rev-parse.*HEAD/s);
  assert.match(build, /docker image inspect/);
  assert.match(build, /SHA256SUMS\.txt/);
  assert.match(build, /artifact-manifest\.json/);
  assert.match(build, /Compress-Archive/);
  assert.match(build, /Security\.Cryptography\.SHA256.*Create/s);
  assert.doesNotMatch(build, /Get-FileHash/);
  assert.doesNotMatch(build, /Copy-Item[^\n]*(?:\.pem|server\.key|device-token|secrets)/i);
});
