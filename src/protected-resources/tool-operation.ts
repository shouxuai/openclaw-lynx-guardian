import type { ResourceOperation } from "../../shared/src/decision.js";

export function classifyToolResourceOperations(
  toolName: string,
  params: Record<string, unknown> = {},
): ResourceOperation[] {
  const text = `${toolName} ${Object.values(params).map((value) => String(value ?? "")).join(" ")}`.toLowerCase();
  const operations = new Set<ResourceOperation>();

  if (/\b(read|open|view|cat|type|get-content|gc|head|tail)\b/.test(text)) operations.add("read");
  if (/\b(ls|dir|get-childitem|gci)\b/.test(text)) operations.add("list");
  if (/\b(rg|grep|findstr|select-string|find)\b/.test(text)) operations.add("search");
  if (/\b(write|edit|apply_patch|set-content|add-content|out-file|tee)\b|>\s*[^&]/.test(text)) operations.add("write");
  if (/\b(new-item|mkdir|touch)\b/.test(text)) operations.add("create");
  if (/\b(mv|move|rename|move-item|rename-item|ren)\b/.test(text)) operations.add("rename");
  if (/\b(chmod|icacls|set-acl)\b/.test(text)) operations.add("chmod");
  if (/\b(rm|del|remove-item|rmdir|rd|unlink)\b/.test(text)) operations.add("delete");

  return [...operations];
}
