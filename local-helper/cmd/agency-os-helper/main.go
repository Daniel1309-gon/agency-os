package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"

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
	hostname := flags.String("hostname", "", "This Windows host name")
	label := flags.String("label", "", "Human-readable device label")
	tokenFile := flags.String("token-file", "", "Path where the managed-policy installer will read the device token")
	if err := flags.Parse(arguments); err != nil {
		return err
	}
	if *tokenFile == "" {
		return fmt.Errorf("--token-file is required; the device token is never printed")
	}
	result, err := enrollment.Enroll(context.Background(), *apiBaseURL, *code, *hostname, *label)
	if err != nil {
		return err
	}
	if err := enrollment.WriteTokenFile(*tokenFile, result.Token); err != nil {
		return err
	}
	fmt.Printf("Device %s enrolled; token stored for managed policy until %s\n", result.DeviceID, result.ExpiresAt.UTC().Format("2006-01-02T15:04:05Z"))
	return nil
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
