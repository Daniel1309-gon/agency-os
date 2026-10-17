package messages

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
)

var (
	uuidPattern          = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)
	chromeProfilePattern = regexp.MustCompile(`^(Default|Profile [0-9]{1,3})$`)
)

type LaunchProfile struct {
	Action           string `json:"action"`
	ProfileID        string `json:"profileId"`
	SessionID        string `json:"sessionId"`
	ChromeProfileDir string `json:"chromeProfileDir"`
	LaunchURL        string `json:"launchUrl"`
}

func DecodeLaunchProfile(payload []byte) (LaunchProfile, error) {
	var message LaunchProfile
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&message); err != nil {
		return LaunchProfile{}, fmt.Errorf("invalid native message")
	}
	if err := ValidateLaunchProfile(message); err != nil {
		return LaunchProfile{}, err
	}
	return message, nil
}

func ValidateLaunchProfile(message LaunchProfile) error {
	if message.Action != "launchProfile" && message.Action != "closeProfile" {
		return fmt.Errorf("unsupported action")
	}
	if !uuidPattern.MatchString(message.ProfileID) || !uuidPattern.MatchString(message.SessionID) {
		return fmt.Errorf("invalid session identity")
	}
	if !chromeProfilePattern.MatchString(message.ChromeProfileDir) {
		return fmt.Errorf("invalid Chrome profile directory")
	}
	parsed, err := url.Parse(message.LaunchURL)
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() != "talkytimes.com" || len(parsed.Path) < len("/auth/login") || parsed.Path[:len("/auth/login")] != "/auth/login" {
		return fmt.Errorf("invalid launch URL")
	}
	return nil
}
