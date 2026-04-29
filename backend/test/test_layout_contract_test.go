package backend_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBackendTestsDoNotLiveUnderInternal(t *testing.T) {
	repoRoot := backendRepoRoot(t)
	internalRoot := filepath.Join(repoRoot, "internal")

	var offenders []string
	err := filepath.WalkDir(internalRoot, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		if strings.HasSuffix(entry.Name(), "_test.go") {
			rel, err := filepath.Rel(repoRoot, path)
			if err != nil {
				return err
			}
			offenders = append(offenders, filepath.ToSlash(rel))
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk backend/internal: %v", err)
	}
	if len(offenders) > 0 {
		t.Fatalf("backend tests must live under backend/test, found internal tests: %v", offenders)
	}
}

func backendRepoRoot(t *testing.T) string {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	for {
		if _, err := os.Stat(filepath.Join(wd, "go.mod")); err == nil {
			return wd
		}
		next := filepath.Dir(wd)
		if next == wd {
			t.Fatalf("could not find backend go.mod from %s", wd)
		}
		wd = next
	}
}
