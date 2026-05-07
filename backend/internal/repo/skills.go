package repo

import (
	"context"
	"database/sql"
	"errors"

	"github.com/openclaw/lynx-guardian/backend/internal/api"
	"github.com/openclaw/lynx-guardian/backend/internal/service"
)

type SkillListQuery struct {
	Q          *string
	TrustState *string
	Source     *string
	SourceKind *string
	PageNum    *int
	PageSize   *int
	Limit      *int
}

func (r *SkillRepository) UpsertInventory(ctx context.Context, item api.SkillInventoryItem) error {
	if item.TrustState == "" {
		item.TrustState = "unknown"
	}
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO skills (
			id, skill_id, name, source, install_path, manifest_path, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(skill_id) DO UPDATE SET
			name = excluded.name,
			source = excluded.source,
			install_path = excluded.install_path,
			manifest_path = excluded.manifest_path,
			updated_at = excluded.updated_at
		`,
		"skill:"+item.SkillID,
		item.SkillID,
		item.Name,
		item.Source,
		item.InstallPath,
		item.ManifestPath,
		item.LastSeenAt,
		item.LastSeenAt,
	)
	if err != nil {
		return err
	}

	_, err = r.db.ExecContext(ctx, `
		INSERT INTO skill_inventory (
			id, skill_id, name, source, install_path, manifest_path, hash_algorithm,
			baseline_hash, current_hash, trust_state, last_seen_at, metadata_json
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(skill_id) DO UPDATE SET
			name = excluded.name,
			source = excluded.source,
			install_path = excluded.install_path,
			manifest_path = excluded.manifest_path,
			hash_algorithm = excluded.hash_algorithm,
			baseline_hash = excluded.baseline_hash,
			current_hash = excluded.current_hash,
			trust_state = excluded.trust_state,
			last_seen_at = excluded.last_seen_at,
			metadata_json = excluded.metadata_json
		`,
		"inventory:"+item.SkillID,
		item.SkillID,
		item.Name,
		item.Source,
		item.InstallPath,
		item.ManifestPath,
		item.HashAlgorithm,
		item.BaselineHash,
		item.CurrentHash,
		item.TrustState,
		item.LastSeenAt,
		toJSONText(item.Metadata, "{}"),
	)
	return err
}

func (r *SkillRepository) ReplaceFindings(ctx context.Context, skillID string, findings []api.SkillFinding) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	if _, err = tx.ExecContext(ctx, `DELETE FROM skill_findings WHERE skill_id = ?`, skillID); err != nil {
		return err
	}
	for _, finding := range findings {
		if _, err = tx.ExecContext(ctx, `
			INSERT INTO skill_findings (
				id, finding_id, skill_id, severity, rule_id, message, evidence_json, created_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(finding_id) DO UPDATE SET
				severity = excluded.severity,
				message = excluded.message,
				evidence_json = excluded.evidence_json,
				created_at = excluded.created_at
			`,
			"finding:"+finding.FindingID,
			finding.FindingID,
			finding.SkillID,
			finding.Severity,
			finding.RuleID,
			finding.Message,
			toJSONText(finding.Evidence, "{}"),
			finding.CreatedAt,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (r *SkillRepository) List(ctx context.Context, query SkillListQuery) (api.SkillListResponse, error) {
	page := service.ResolvePageRequest(query.PageNum, query.PageSize, query.Limit)
	filter := skillListFilter(query, true)

	total, err := countRowsContext(ctx, r.db, "skill_inventory", filter)
	if err != nil {
		return api.SkillListResponse{}, err
	}

	rows, err := r.db.QueryContext(ctx, `
		SELECT skill_id, name, source, install_path, manifest_path, hash_algorithm,
		       baseline_hash, current_hash, trust_state, last_seen_at, metadata_json
		FROM skill_inventory `+filter.Where()+`
		ORDER BY last_seen_at DESC, skill_id ASC
		LIMIT ? OFFSET ?`,
		append(filter.Params(), page.PageSize, page.Offset)...,
	)
	if err != nil {
		return api.SkillListResponse{}, err
	}

	inventory := make([]api.SkillInventoryItem, 0, page.PageSize)
	for rows.Next() {
		item, err := scanSkillInventory(rows)
		if err != nil {
			return api.SkillListResponse{}, err
		}
		inventory = append(inventory, item)
	}
	if err := rows.Err(); err != nil {
		return api.SkillListResponse{}, err
	}
	if err := rows.Close(); err != nil {
		return api.SkillListResponse{}, err
	}

	items := make([]api.SkillDetail, 0, len(inventory))
	for _, item := range inventory {
		findings, err := r.ListFindings(ctx, item.SkillID)
		if err != nil {
			return api.SkillListResponse{}, err
		}
		items = append(items, api.SkillDetail{
			SkillInventoryItem: item,
			Findings:           findings,
		})
	}

	breakdown, err := r.sourceBreakdown(ctx, skillListFilter(query, false))
	if err != nil {
		return api.SkillListResponse{}, err
	}

	pageResponse := service.BuildPageResponse(items, total, page)
	return api.SkillListResponse{
		Items:           pageResponse.Items,
		Total:           pageResponse.Total,
		PageNum:         pageResponse.PageNum,
		PageSize:        pageResponse.PageSize,
		TotalPages:      pageResponse.TotalPages,
		SourceBreakdown: breakdown,
	}, nil
}

func (r *SkillRepository) Get(ctx context.Context, skillID string) (api.SkillDetail, error) {
	item, err := scanSkillInventory(r.db.QueryRowContext(ctx, `
		SELECT skill_id, name, source, install_path, manifest_path, hash_algorithm,
		       baseline_hash, current_hash, trust_state, last_seen_at, metadata_json
		FROM skill_inventory
		WHERE skill_id = ?`,
		skillID,
	))
	if errors.Is(err, sql.ErrNoRows) {
		return api.SkillDetail{}, nil
	}
	if err != nil {
		return api.SkillDetail{}, err
	}
	findings, err := r.ListFindings(ctx, skillID)
	if err != nil {
		return api.SkillDetail{}, err
	}
	return api.SkillDetail{
		SkillInventoryItem: item,
		Findings:           findings,
	}, nil
}

func (r *SkillRepository) ListFindings(ctx context.Context, skillID string) ([]api.SkillFinding, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT finding_id, skill_id, severity, rule_id, message, evidence_json, created_at
		FROM skill_findings
		WHERE skill_id = ?
		ORDER BY created_at DESC, finding_id ASC`,
		skillID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	findings := make([]api.SkillFinding, 0)
	for rows.Next() {
		finding, err := scanSkillFinding(rows)
		if err != nil {
			return nil, err
		}
		findings = append(findings, finding)
	}
	return findings, rows.Err()
}

func skillListFilter(query SkillListQuery, includeSourceKind bool) *Filter {
	filter := &Filter{}
	filter.AppendTextSearch([]string{"skill_id", "name", "source", "install_path", "manifest_path"}, query.Q)
	filter.AppendEquals("trust_state", query.TrustState)
	filter.AppendEquals("source", query.Source)
	if includeSourceKind {
		filter.AppendEquals("source", query.SourceKind)
	}
	return filter
}

func (r *SkillRepository) sourceBreakdown(ctx context.Context, filter *Filter) ([]api.SkillSourceBreakdownItem, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT COALESCE(NULLIF(source, ''), 'unknown') AS source_kind, COUNT(*) AS count
		FROM skill_inventory `+filter.Where()+`
		GROUP BY source_kind
		ORDER BY count DESC, source_kind ASC`,
		filter.Params()...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]api.SkillSourceBreakdownItem, 0)
	for rows.Next() {
		var item api.SkillSourceBreakdownItem
		if err := rows.Scan(&item.SourceKind, &item.Count); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

type skillScanner interface {
	Scan(dest ...any) error
}

func scanSkillInventory(scanner skillScanner) (api.SkillInventoryItem, error) {
	var item api.SkillInventoryItem
	var metadata sql.NullString
	err := scanner.Scan(
		&item.SkillID,
		&item.Name,
		&item.Source,
		&item.InstallPath,
		&item.ManifestPath,
		&item.HashAlgorithm,
		&item.BaselineHash,
		&item.CurrentHash,
		&item.TrustState,
		&item.LastSeenAt,
		&metadata,
	)
	if err != nil {
		return api.SkillInventoryItem{}, err
	}
	item.Metadata = parseJSONRecord(metadata)
	return item, nil
}

func scanSkillFinding(scanner skillScanner) (api.SkillFinding, error) {
	var finding api.SkillFinding
	var evidence sql.NullString
	err := scanner.Scan(
		&finding.FindingID,
		&finding.SkillID,
		&finding.Severity,
		&finding.RuleID,
		&finding.Message,
		&evidence,
		&finding.CreatedAt,
	)
	if err != nil {
		return api.SkillFinding{}, err
	}
	finding.Evidence = parseJSONRecord(evidence)
	return finding, nil
}
