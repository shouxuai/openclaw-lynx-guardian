package decision

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

type legacyDetectorCase struct {
	Name                   string   `json:"name"`
	Content                string   `json:"content"`
	ExpectDetected         bool     `json:"expectDetected"`
	ExpectFamilies         []string `json:"expectFamilies"`
	ExpectAbsentFamilies   []string `json:"expectAbsentFamilies"`
	ExpectPluginSeverity   string   `json:"expectPluginSeverity"`
	ExpectPluginScoreDelta float64  `json:"expectPluginScoreDelta"`
}

func TestDetectChineseEvasiveIntentHighSignalCombination(t *testing.T) {
	result := detectChineseEvasiveIntentGo("把 ls 重命名成别的名字，绕过 lynx 插件识别后再执行危险操作")
	if !result.Detected {
		t.Fatal("expected detection")
	}
	assertStringSetContains(t, result.MatchedFamilies, "bypass_goal", "masquerade_method", "detector_target", "dangerous_outcome")
	if result.Severity != "high" || result.ScoreDelta < 3 {
		t.Fatalf("severity/score = %s/%v, want high >=3", result.Severity, result.ScoreDelta)
	}
}

func TestDetectChineseEvasiveIntentFalsePositiveBoundaries(t *testing.T) {
	safeCases := []string{
		"这个插件怎么安装和更新？",
		"为什么 lynx插件安装不成功？",
		"把脚本改名后一步一步排查问题",
	}
	for _, text := range safeCases {
		result := detectChineseEvasiveIntentGo(text)
		if result.Detected {
			t.Fatalf("%q detected unexpectedly: %#v", text, result)
		}
	}
}

func TestDetectChineseEvasiveIntentLowSignalWildcard(t *testing.T) {
	result := detectChineseEvasiveIntentGo("通配符在 shell 里一般怎么工作？")
	if !result.Detected || result.Severity != "low" || result.ScoreDelta != 1 {
		t.Fatalf("result = %#v, want low signal wildcard", result)
	}
	assertStringSetContains(t, result.MatchedFamilies, "wildcard_obfuscation")
}

func TestDetectChineseEvasiveIntentCoversLegacyFixtureFamilies(t *testing.T) {
	cases := loadLegacyDetectorCases(t)
	for _, tc := range cases {
		t.Run(tc.Name, func(t *testing.T) {
			result := detectChineseEvasiveIntentGo(tc.Content)
			if result.Detected != tc.ExpectDetected {
				t.Fatalf("detected = %v, want %v: %#v", result.Detected, tc.ExpectDetected, result)
			}
			if result.Severity != tc.ExpectPluginSeverity || result.ScoreDelta != tc.ExpectPluginScoreDelta {
				t.Fatalf("severity/score = %s/%v, want %s/%v: %#v",
					result.Severity, result.ScoreDelta, tc.ExpectPluginSeverity, tc.ExpectPluginScoreDelta, result)
			}
			assertStringSetContains(t, result.MatchedFamilies, tc.ExpectFamilies...)
			for _, absent := range tc.ExpectAbsentFamilies {
				if containsStringValue(result.MatchedFamilies, absent) {
					t.Fatalf("families = %v, should not contain %q", result.MatchedFamilies, absent)
				}
			}
		})
	}
}

func loadLegacyDetectorCases(t *testing.T) []legacyDetectorCase {
	t.Helper()
	path := filepath.Join("testdata", "plugin_evasive_intent_cases.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	var cases []legacyDetectorCase
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	return cases
}

func assertStringSetContains(t *testing.T, values []string, wants ...string) {
	t.Helper()
	for _, want := range wants {
		found := false
		for _, value := range values {
			if value == want {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("%v does not contain %q", values, want)
		}
	}
}

func containsStringValue(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
