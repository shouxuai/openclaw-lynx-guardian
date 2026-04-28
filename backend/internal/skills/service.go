package skills

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/openclaw/lynx-guardian/backend/internal/api"
	"github.com/openclaw/lynx-guardian/backend/internal/repo"
)

type Service struct {
	repository *repo.SkillRepository
	clock      func() time.Time
}

func NewService(repository *repo.SkillRepository) *Service {
	return &Service{
		repository: repository,
		clock:      time.Now,
	}
}

func (s *Service) SyncInventory(ctx context.Context, request api.SkillInventorySyncRequest) (api.SkillInventorySyncResponse, error) {
	items := make([]api.SkillInventoryItem, 0, len(request.Items))
	findings := make([]api.SkillFinding, 0)

	for _, item := range request.Items {
		normalized := normalizeInventoryItem(item, s.clock())
		if err := s.repository.UpsertInventory(ctx, normalized); err != nil {
			return api.SkillInventorySyncResponse{}, err
		}

		itemFindings := s.findingsForInventory(normalized)
		if err := s.repository.ReplaceFindings(ctx, normalized.SkillID, itemFindings); err != nil {
			return api.SkillInventorySyncResponse{}, err
		}
		items = append(items, normalized)
		findings = append(findings, itemFindings...)
	}

	return api.SkillInventorySyncResponse{
		OK:            true,
		AcceptedCount: len(items),
		FindingsCount: len(findings),
		Items:         items,
		Findings:      findings,
	}, nil
}

func normalizeInventoryItem(item api.SkillInventoryItem, now time.Time) api.SkillInventoryItem {
	item.SkillID = strings.TrimSpace(item.SkillID)
	item.Name = strings.TrimSpace(item.Name)
	if item.Name == "" {
		item.Name = item.SkillID
	}
	if item.HashAlgorithm == "" && item.CurrentHash != "" {
		item.HashAlgorithm = "sha256"
	}
	if item.TrustState == "" {
		item.TrustState = "unknown"
	}
	if item.LastSeenAt == "" {
		item.LastSeenAt = now.UTC().Format(time.RFC3339)
	}
	return item
}

func (s *Service) findingsForInventory(item api.SkillInventoryItem) []api.SkillFinding {
	now := s.clock().UTC().Format(time.RFC3339)
	findings := make([]api.SkillFinding, 0, 4)

	if item.ManifestPath == "" {
		findings = append(findings, buildFinding(item, "missing_manifest", "warn", "Skill manifest path is missing.", now, map[string]any{
			"installPath": item.InstallPath,
		}))
	}

	if item.BaselineHash != "" && item.CurrentHash != "" && item.BaselineHash != item.CurrentHash {
		evidence := map[string]any{
			"baselineHash": item.BaselineHash,
			"currentHash":  item.CurrentHash,
			"algorithm":    item.HashAlgorithm,
		}
		findings = append(findings,
			buildFinding(item, "hash_mismatch", "critical", "Skill current hash does not match its baseline.", now, evidence),
			buildFinding(item, "skill_file_changed_after_baseline", "critical", "Skill files changed after baseline capture.", now, evidence),
		)
	}

	if suspiciousSource(item.Source) {
		findings = append(findings, buildFinding(item, "suspicious_install_source", "critical", "Skill source matches a suspicious install location.", now, map[string]any{
			"source": item.Source,
		}))
	}

	if protectedPathWritable(item) {
		findings = append(findings, buildFinding(item, "writeable_protected_skill_path", "warn", "Protected skill path is reported writable.", now, map[string]any{
			"installPath": item.InstallPath,
		}))
	}

	return findings
}

func buildFinding(
	item api.SkillInventoryItem,
	ruleID string,
	severity string,
	message string,
	createdAt string,
	evidence map[string]any,
) api.SkillFinding {
	return api.SkillFinding{
		FindingID: fmt.Sprintf("%s:%s", item.SkillID, ruleID),
		SkillID:   item.SkillID,
		Severity:  severity,
		RuleID:    ruleID,
		Message:   message,
		Evidence:  evidence,
		CreatedAt: createdAt,
	}
}

func suspiciousSource(source string) bool {
	lower := strings.ToLower(strings.TrimSpace(source))
	if lower == "" || lower == "local" || lower == "bundled" || lower == "official" {
		return false
	}
	return strings.Contains(lower, "raw.githubusercontent.com") ||
		strings.Contains(lower, "gist.github.com") ||
		strings.Contains(lower, "pastebin") ||
		strings.Contains(lower, "keylogger") ||
		strings.Contains(lower, "evil")
}

func protectedPathWritable(item api.SkillInventoryItem) bool {
	if item.Metadata == nil {
		return false
	}
	value, ok := item.Metadata["protectedPathWritable"].(bool)
	return ok && value
}
