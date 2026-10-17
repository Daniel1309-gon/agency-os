package launcher

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"sync"

	"agency-os/local-helper/internal/messages"
)

type Launcher struct {
	mu      sync.Mutex
	process map[string]*exec.Cmd
}

func New() *Launcher {
	return &Launcher{process: make(map[string]*exec.Cmd)}
}

func (l *Launcher) Launch(message messages.LaunchProfile) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if existing := l.process[message.SessionID]; existing != nil && existing.Process != nil {
		return fmt.Errorf("session is already launching")
	}

	binary := os.Getenv("AGENCY_OS_CHROME_PATH")
	if binary == "" {
		binary = "chrome.exe"
		if runtime.GOOS != "windows" {
			binary = "google-chrome"
		}
	}
	command := exec.Command(binary,
		"--profile-directory="+message.ChromeProfileDir,
		"--no-first-run",
		"--no-default-browser-check",
		message.LaunchURL,
	)
	command.Stdin = nil
	command.Stdout = nil
	command.Stderr = nil
	if err := command.Start(); err != nil {
		return fmt.Errorf("Chrome could not be started")
	}
	l.process[message.SessionID] = command
	return nil
}

func (l *Launcher) Close(message messages.LaunchProfile) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	command := l.process[message.SessionID]
	if command == nil || command.Process == nil {
		return fmt.Errorf("session is not owned by this helper")
	}
	if runtime.GOOS == "windows" {
		if err := exec.Command("taskkill", "/PID", strconv.Itoa(command.Process.Pid), "/T", "/F").Run(); err != nil {
			return fmt.Errorf("Chrome could not be closed")
		}
	} else {
		if err := command.Process.Kill(); err != nil {
			return fmt.Errorf("Chrome could not be closed")
		}
	}
	delete(l.process, message.SessionID)
	return nil
}
