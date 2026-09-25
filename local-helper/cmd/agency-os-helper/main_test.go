package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestEnrollmentCodeCanBeReadFromARestrictedInstallerFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "enrollment-code.txt")
	if err := os.WriteFile(path, []byte("  one-time-code  \n"), 0600); err != nil {
		t.Fatal(err)
	}
	code, err := enrollmentCode("", path)
	if err != nil {
		t.Fatal(err)
	}
	if code != "one-time-code" {
		t.Fatalf("unexpected code value")
	}
}

func TestEnrollmentCodeRejectsAmbiguousOrEmptyInputs(t *testing.T) {
	if _, err := enrollmentCode("inline", "file"); err == nil {
		t.Fatal("expected ambiguous input to fail")
	}
	if _, err := enrollmentCode("", ""); err == nil {
		t.Fatal("expected missing input to fail")
	}
}
