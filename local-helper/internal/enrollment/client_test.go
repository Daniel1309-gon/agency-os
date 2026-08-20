package enrollment

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWriteTokenFileDoesNotExposeTokenInAReadablePath(t *testing.T) {
	path := filepath.Join(t.TempDir(), "device-token.txt")
	if err := WriteTokenFile(path, "token-for-test"); err != nil {
		t.Fatal(err)
	}
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "token-for-test" {
		t.Fatalf("unexpected token contents")
	}
}
