export function formatQaRecordId(qaRecordId: string | undefined): string {
  return qaRecordId && qaRecordId.trim().length > 0 ? qaRecordId : "未关联问答记录";
}
