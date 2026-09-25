package enrollment

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

func TestFingerprintFromPEMHashesTheDerCertificate(t *testing.T) {
	// Un certificado PEM minimo: solo importa que el DER decodificado sea estable.
	der := []byte("test-certificate-der-bytes")
	pem := "-----BEGIN CERTIFICATE-----\n" + base64.StdEncoding.EncodeToString(der) + "\n-----END CERTIFICATE-----\n"
	path := filepath.Join(t.TempDir(), "device.pem")
	if err := os.WriteFile(path, []byte(pem), 0600); err != nil {
		t.Fatal(err)
	}
	fingerprint, err := FingerprintFromPEM(path)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(der)
	if fingerprint != hex.EncodeToString(digest[:]) {
		t.Fatalf("unexpected fingerprint %s", fingerprint)
	}
}

func TestFingerprintFromPEMRejectsNonPEMInput(t *testing.T) {
	path := filepath.Join(t.TempDir(), "not-a-cert.pem")
	if err := os.WriteFile(path, []byte("plain text"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := FingerprintFromPEM(path); err == nil {
		t.Fatal("expected non-PEM input to fail")
	}
}

func TestEnrollRejectsAnInvalidFingerprintBeforeCallingTheApi(t *testing.T) {
	if _, err := Enroll(t.Context(), "https://api.example.test/api/v1", "code", "host", "label", "NOT-HEX"); err == nil {
		t.Fatal("expected an invalid fingerprint to fail")
	}
}
