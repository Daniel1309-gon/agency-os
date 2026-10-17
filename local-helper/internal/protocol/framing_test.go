package protocol

import (
	"bytes"
	"testing"
)

func TestNativeMessageFramingRoundTrip(t *testing.T) {
	var buffer bytes.Buffer
	if err := WriteMessage(&buffer, []byte(`{"ok":true}`)); err != nil {
		t.Fatal(err)
	}
	message, err := ReadMessage(&buffer)
	if err != nil {
		t.Fatal(err)
	}
	if string(message) != `{"ok":true}` {
		t.Fatalf("unexpected payload: %s", message)
	}
}

func TestReadMessageRejectsOversizedPayload(t *testing.T) {
	var buffer bytes.Buffer
	buffer.Write([]byte{0xff, 0xff, 0xff, 0xff})
	if _, err := ReadMessage(&buffer); err == nil {
		t.Fatal("oversized message was accepted")
	}
}
