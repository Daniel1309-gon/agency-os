package messages

import "testing"

const validUUID = "123e4567-e89b-12d3-a456-426614174000"

func TestDecodeLaunchProfileRejectsSecretsAndUnsafeDestinations(t *testing.T) {
	valid := []byte(`{"action":"launchProfile","profileId":"123e4567-e89b-12d3-a456-426614174000","sessionId":"123e4567-e89b-12d3-a456-426614174001","chromeProfileDir":"Profile 1","launchUrl":"https://talkytimes.com/auth/login?agencyProfile=1"}`)
	if _, err := DecodeLaunchProfile(valid); err != nil {
		t.Fatalf("valid message rejected: %v", err)
	}
	for _, payload := range []string{
		`{"action":"launchProfile","profileId":"123e4567-e89b-12d3-a456-426614174000","sessionId":"123e4567-e89b-12d3-a456-426614174001","chromeProfileDir":"..\\Secrets","launchUrl":"https://talkytimes.com/auth/login"}`,
		`{"action":"launchProfile","profileId":"123e4567-e89b-12d3-a456-426614174000","sessionId":"123e4567-e89b-12d3-a456-426614174001","chromeProfileDir":"Default","launchUrl":"https://evil.example/auth/login"}`,
		`{"action":"launchProfile","profileId":"123e4567-e89b-12d3-a456-426614174000","sessionId":"123e4567-e89b-12d3-a456-426614174001","chromeProfileDir":"Default","launchUrl":"https://talkytimes.com/auth/login","accessToken":"secret"}`,
	} {
		if _, err := DecodeLaunchProfile([]byte(payload)); err == nil {
			t.Fatalf("unsafe message accepted: %s", payload)
		}
	}
}

func TestValidateLaunchProfileAcceptsCloseAction(t *testing.T) {
	if err := ValidateLaunchProfile(LaunchProfile{
		Action: "closeProfile", ProfileID: validUUID, SessionID: "123e4567-e89b-12d3-a456-426614174001", ChromeProfileDir: "Default", LaunchURL: "https://talkytimes.com/auth/login",
	}); err != nil {
		t.Fatalf("close message rejected: %v", err)
	}
}
