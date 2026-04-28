package service

// IngestService mirrors services/ingest-service.ts.
//
// NOTE: This is a deliberate TODO. The TS version uses Zod's discriminated
// union to validate a polymorphic items array and persist each one through the
// IngestRepository transaction. Porting that faithfully takes a proper pass
// over shared/src/ingest.ts and all six persist* methods, so we keep this
// stubbed to unblock the rest of the skeleton.
//
// Suggested Go plan:
//   1. Define typed structs per item kind under internal/api (or internal/ingest).
//   2. Use encoding/json.RawMessage + a manual switch on "kind" to match zod's
//      discriminatedUnion, validating with go-playground/validator or hand rolls.
//   3. IngestRepository methods should return a (status string, err error) pair
//      matching {persisted, duplicate}.
//   4. Wrap the persist loop in a single sql.Tx.
type IngestService struct{}

func NewIngestService() *IngestService {
	return &IngestService{}
}

// IngestBatchResult is the response shape returned to clients.
type IngestBatchResult struct {
	OK             bool            `json:"ok"`
	SchemaVersion  string          `json:"schemaVersion"`
	BatchID        string          `json:"batchId"`
	AcceptedCount  int             `json:"acceptedCount"`
	PersistedCount int             `json:"persistedCount"`
	DuplicateCount int             `json:"duplicateCount"`
	RejectedCount  int             `json:"rejectedCount"`
	RejectedItems  []RejectedItem  `json:"rejectedItems"`
	ServerTimeMs   int64           `json:"serverTimeMs"`
}

type RejectedItem struct {
	ItemIndex int    `json:"itemIndex"`
	Kind      string `json:"kind"`
	Code      string `json:"code"`
	Message   string `json:"message"`
}
