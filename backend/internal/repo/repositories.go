package repo

import "database/sql"

// Repository structs are kept in one place so app wiring stays compact.

type DashboardRepository struct{ db *sql.DB }

func NewDashboardRepository(db *sql.DB) *DashboardRepository {
	return &DashboardRepository{db: db}
}

type EventsRepository struct{ db *sql.DB }

func NewEventsRepository(db *sql.DB) *EventsRepository { return &EventsRepository{db: db} }

type ToolCallsRepository struct{ db *sql.DB }

func NewToolCallsRepository(db *sql.DB) *ToolCallsRepository { return &ToolCallsRepository{db: db} }

type SessionsRepository struct{ db *sql.DB }

func NewSessionsRepository(db *sql.DB) *SessionsRepository { return &SessionsRepository{db: db} }

type LynxChecksRepository struct{ db *sql.DB }

func NewLynxChecksRepository(db *sql.DB) *LynxChecksRepository {
	return &LynxChecksRepository{db: db}
}

type TokensRepository struct{ db *sql.DB }

func NewTokensRepository(db *sql.DB) *TokensRepository { return &TokensRepository{db: db} }

type IngestRepository struct{ db *sql.DB }

func NewIngestRepository(db *sql.DB) *IngestRepository { return &IngestRepository{db: db} }

type SkillRepository struct{ db *sql.DB }

func NewSkillRepository(db *sql.DB) *SkillRepository { return &SkillRepository{db: db} }

type PolicyRepository struct{ db *sql.DB }

func NewPolicyRepository(db *sql.DB) *PolicyRepository { return &PolicyRepository{db: db} }
