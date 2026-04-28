package repo

import "database/sql"

// Stubs for repositories that are not fully ported yet. Each one should grow
// into a full sibling of approvals.go. Follow the pattern:
//   1. Define a TS-mirrored query struct.
//   2. Implement List(...) (service.CursorPage[T], error) using *Filter.
//   3. Implement GetByID(...) returning a pointer + (nil, nil) on miss.

type DashboardRepository struct{ db *sql.DB }

func NewDashboardRepository(db *sql.DB) *DashboardRepository {
	return &DashboardRepository{db: db}
}

// TODO: port dashboard-repository.ts

type EventsRepository struct{ db *sql.DB }

func NewEventsRepository(db *sql.DB) *EventsRepository { return &EventsRepository{db: db} }

// TODO: port events-repository.ts

type ToolCallsRepository struct{ db *sql.DB }

func NewToolCallsRepository(db *sql.DB) *ToolCallsRepository { return &ToolCallsRepository{db: db} }

// TODO: port tool-calls-repository.ts

type SessionsRepository struct{ db *sql.DB }

func NewSessionsRepository(db *sql.DB) *SessionsRepository { return &SessionsRepository{db: db} }

// TODO: port sessions-repository.ts

type LynxChecksRepository struct{ db *sql.DB }

func NewLynxChecksRepository(db *sql.DB) *LynxChecksRepository {
	return &LynxChecksRepository{db: db}
}

// TODO: port lynx-checks-repository.ts

type TokensRepository struct{ db *sql.DB }

func NewTokensRepository(db *sql.DB) *TokensRepository { return &TokensRepository{db: db} }

// TODO: port tokens-repository.ts

type IngestRepository struct{ db *sql.DB }

func NewIngestRepository(db *sql.DB) *IngestRepository { return &IngestRepository{db: db} }

// TODO: port ingest-repository.ts (persist* methods + transaction wrapper)
