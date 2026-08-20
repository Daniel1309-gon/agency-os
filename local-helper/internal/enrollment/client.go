package enrollment

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Result struct {
	DeviceID  string    `json:"deviceId"`
	Token     string    `json:"deviceToken"`
	ExpiresAt time.Time `json:"expiresAt"`
}

func Enroll(ctx context.Context, apiBaseURL, code, hostname, label string) (Result, error) {
	base, err := url.Parse(strings.TrimRight(apiBaseURL, "/"))
	if err != nil || (base.Scheme != "https" && base.Hostname() != "localhost") {
		return Result{}, fmt.Errorf("API base URL must use HTTPS")
	}
	if strings.TrimSpace(code) == "" || strings.TrimSpace(hostname) == "" || strings.TrimSpace(label) == "" {
		return Result{}, fmt.Errorf("enrollment code, hostname and label are required")
	}
	payload, err := json.Marshal(map[string]string{"code": code, "hostname": hostname, "label": label})
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
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil || result.DeviceID == "" || result.Token == "" {
		return Result{}, fmt.Errorf("enrollment response is invalid")
	}
	return result, nil
}

func WriteTokenFile(path, token string) error {
	if token == "" {
		return fmt.Errorf("device token is empty")
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("token path is invalid")
	}
	file, err := os.OpenFile(absolute, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil {
		return fmt.Errorf("could not store device token")
	}
	defer file.Close()
	if _, err := file.WriteString(token); err != nil {
		return fmt.Errorf("could not store device token")
	}
	return file.Chmod(0600)
}
