package protocol

import (
	"encoding/binary"
	"fmt"
	"io"
)

const MaxMessageSize = 64 * 1024

func ReadMessage(reader io.Reader) ([]byte, error) {
	var header [4]byte
	if _, err := io.ReadFull(reader, header[:]); err != nil {
		return nil, err
	}
	size := binary.LittleEndian.Uint32(header[:])
	if size == 0 || size > MaxMessageSize {
		return nil, fmt.Errorf("native message size is invalid")
	}
	payload := make([]byte, size)
	if _, err := io.ReadFull(reader, payload); err != nil {
		return nil, err
	}
	return payload, nil
}

func WriteMessage(writer io.Writer, payload []byte) error {
	if len(payload) == 0 || len(payload) > MaxMessageSize {
		return fmt.Errorf("native response size is invalid")
	}
	var header [4]byte
	binary.LittleEndian.PutUint32(header[:], uint32(len(payload)))
	if _, err := writer.Write(header[:]); err != nil {
		return err
	}
	_, err := writer.Write(payload)
	return err
}
