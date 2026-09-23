package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"agency-os/local-helper/internal/enrollment"
	"agency-os/local-helper/internal/launcher"
	"agency-os/local-helper/internal/messages"
	"agency-os/local-helper/internal/protocol"
)

type response struct {
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "enroll" {
		if err := runEnrollment(os.Args[2:]); err != nil {
			fmt.Fprintln(os.Stderr, "Agency OS enrollment failed:", err)
			os.Exit(1)
		}
		return
	}
	if err := runNativeMessaging(os.Stdin, os.Stdout); err != nil && !errors.Is(err, io.EOF) {
		// Native Messaging reserves stdout for framed JSON only. Keep diagnostics
		// on stderr and do not include request data in them.
		fmt.Fprintln(os.Stderr, "Agency OS helper stopped:", err)
		os.Exit(1)
	}
}

func runEnrollment(arguments []string) error {
	flags := flag.NewFlagSet("enroll", flag.ContinueOnError)
	apiBaseURL := flags.String("api-base-url", "", "Agency OS API base URL, including /api/v1")
	code := flags.String("code", "", "One-time enrollment code")
	codeFile := flags.String("code-file", "", "Restricted file containing the one-time enrollment code")
	hostname := flags.String("hostname", "", "This Windows host name")
	label := flags.String("label", "", "Human-readable device label")
	certFile := flags.String("cert-file", "", "PEM certificate issued for this PC; its SHA-256 is registered as the device identity")
	certFingerprint := flags.String("cert-fingerprint", "", "Precomputed lowercase SHA-256 fingerprint, when the certificate is not available as a file")
	if err := flags.Parse(arguments); err != nil {
		return err
	}
	enrollmentCodeValue, err := enrollmentCode(*code, *codeFile)
	if err != nil {
		return err
	}
	fingerprint := strings.TrimSpace(*certFingerprint)
	if fingerprint == "" {
		if *certFile == "" {
			return fmt.Errorf("provide --cert-file or --cert-fingerprint; the device identity is its certificate")
		}
		fingerprint, err = enrollment.FingerprintFromPEM(*certFile)
		if err != nil {
			return err
		}
	}
	result, err := enrollment.Enroll(context.Background(), *apiBaseURL, enrollmentCodeValue, *hostname, *label, fingerprint)
	if err != nil {
		return err
	}
	fmt.Printf("Device %s enrolled with certificate fingerprint %s\n", result.DeviceID, fingerprint)
	return nil
}

func enrollmentCode(inline, path string) (string, error) {
	if inline != "" && path != "" {
		return "", fmt.Errorf("use exactly one of --code or --code-file")
	}
	if path == "" {
		if inline == "" {
			return "", fmt.Errorf("--code-file is required when --code is not provided")
		}
		return inline, nil
	}
	contents, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("could not read enrollment code file")
	}
	if len(contents) > 256 {
		return "", fmt.Errorf("enrollment code file is invalid")
	}
	value := strings.TrimSpace(string(contents))
	if value == "" {
		return "", fmt.Errorf("enrollment code file is empty")
	}
	return value, nil
}

func runNativeMessaging(reader io.Reader, writer io.Writer) error {
	processLauncher := launcher.New()
	for {
		payload, err := protocol.ReadMessage(reader)
		if err != nil {
			return err
		}
		message, err := messages.DecodeLaunchProfile(payload)
		if err == nil {
			if message.Action == "launchProfile" {
				err = processLauncher.Launch(message)
			} else {
				err = processLauncher.Close(message)
			}
		}
		result := response{OK: err == nil}
		if err != nil {
			result.Error = err.Error()
		}
		encoded, encodeErr := json.Marshal(result)
		if encodeErr != nil {
			return encodeErr
		}
		if writeErr := protocol.WriteMessage(writer, encoded); writeErr != nil {
			return writeErr
		}
	}
}
