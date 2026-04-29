package service

type PageRequest struct {
	PageNum  int
	PageSize int
	Offset   int
}

type PageResponse[T any] struct {
	Items      []T `json:"items"`
	Total      int `json:"total"`
	PageNum    int `json:"pageNum"`
	PageSize   int `json:"pageSize"`
	TotalPages int `json:"totalPages"`
}

func ResolvePageRequest(pageNum, pageSize, legacyLimit *int) PageRequest {
	resolvedPageNum := 1
	if pageNum != nil && *pageNum > 0 {
		resolvedPageNum = *pageNum
	}

	resolvedPageSize := DefaultListLimit
	if pageSize != nil {
		if *pageSize > 0 {
			resolvedPageSize = *pageSize
		}
	} else if legacyLimit != nil && *legacyLimit > 0 {
		resolvedPageSize = *legacyLimit
	}
	if resolvedPageSize > MaxListLimit {
		resolvedPageSize = MaxListLimit
	}

	return PageRequest{
		PageNum:  resolvedPageNum,
		PageSize: resolvedPageSize,
		Offset:   (resolvedPageNum - 1) * resolvedPageSize,
	}
}

func BuildPageResponse[T any](items []T, total int, page PageRequest) PageResponse[T] {
	totalPages := 0
	if total > 0 {
		totalPages = (total + page.PageSize - 1) / page.PageSize
	}
	return PageResponse[T]{
		Items:      items,
		Total:      total,
		PageNum:    page.PageNum,
		PageSize:   page.PageSize,
		TotalPages: totalPages,
	}
}
