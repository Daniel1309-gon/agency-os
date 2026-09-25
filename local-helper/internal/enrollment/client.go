package enrollment

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
)

type Result struct {
	DeviceID string `json:"deviceId"`
}

// FingerprintFromPEM returns the SHA-256 hex digest of the DER certificate
// inside a PEM file, which is the public identity Agency OS stores.
func FingerprintFromPEM(path string) (string, error) {
	contents, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("could not read certificate file")
	}
	const begin = "-----BEGIN CERTIFICATE-----"
	const end = "-----END CERTIFICATE-----"
	text := string(contents)
	start := strings.Index(text, begin)
	stop := strings.Index(text, end)
	if start < 0 || stop < 0 || stop <= start {
		return "", fmt.Errorf("certificate file is not a PEM certificate")
	}
	encoded := strings.Join(strings.Fields(text[start+len(begin):stop]), "")
	der, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(der) == 0 {
		return "", fmt.Errorf("certificate file is not a PEM certificate")
	}
	digest := sha256.Sum256(der)
	return hex.EncodeToString(digest[:]), nil
}

func Enroll(ctx context.Context, apiBaseURL, code, hostname, label, certFingerprint string) (Result, error) {
	base, err := url.Parse(strings.TrimRight(apiBaseURL, "/"))
	if err != nil || (base.Scheme != "https" && base.Hostname() != "localhost") {
		return Result{}, fmt.Errorf("API base URL must use HTTPS")
	}
	if strings.TrimSpace(code) == "" || strings.TrimSpace(hostname) == "" || strings.TrimSpace(label) == "" {
		return Result{}, fmt.Errorf("enrollment code, hostname and label are required")
	}
	if len(certFingerprint) != 64 || strings.ToLower(certFingerprint) != certFingerprint {
		return Result{}, fmt.Errorf("certificate fingerprint must be a lowercase SHA-256 hex digest")
	}
	payload, err := json.Marshal(map[string]string{
		"code":            code,
		"hostname":        hostname,
		"label":           label,
		"certFingerprint": certFingerprint,
	})
	if err != nil {
		return Result{}, fmt.Errorf("could not encode enrollment request")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, base.String()+"/devices/enroll", strings.NewReader(string(payload)))
	if err != nil {
		return Result{}, fmt.Errorf("could not create enrollment request")
	}
	request.Header.Set("content-type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return Result{}, fmt.Errorf("enrollment request failed")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return Result{}, fmt.Errorf("enrollment rejected")
	}
	var result Result
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil || result.DeviceID == "" {
		return Result{}, fmt.Errorf("enrollment response is invalid")
	}
	return result, nil
}
