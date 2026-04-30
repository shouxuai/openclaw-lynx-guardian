import { describe, expect, it } from "vitest";
import { buildProtectedResourceDenialExplanation } from "../src/protected-resources/explanation.js";
import { classifyToolResourceOperations } from "../src/protected-resources/tool-operation.js";

describe("protected resource operation mapping", () => {
  it("maps read-like tools and commands to read/list/search", () => {
    expect(classifyToolResourceOperations("read", { path: "C:\\secret\\a.txt" })).toContain("read");
    expect(classifyToolResourceOperations("exec", { command: "rg token C:\\secret" })).toContain("search");
    expect(classifyToolResourceOperations("exec", { command: "Get-ChildItem C:\\secret" })).toContain("list");
  });

  it("maps mutation commands to write, rename, chmod, and delete", () => {
    expect(classifyToolResourceOperations("write", { file_path: "C:\\secret\\a.txt" })).toContain("write");
    expect(classifyToolResourceOperations("exec", { command: "Rename-Item a b" })).toContain("rename");
    expect(classifyToolResourceOperations("exec", { command: "icacls C:\\secret /grant Everyone:F" })).toContain("chmod");
    expect(classifyToolResourceOperations("exec", { command: "Remove-Item C:\\secret -Recurse" })).toContain("delete");
  });

  it("explains protected resource denials with the deterministic rule id", () => {
    const explanation = buildProtectedResourceDenialExplanation([
      {
        evidenceId: "resource-1",
        resourceId: "res-proof",
        matchedPath: "/tmp/lynx-protected-proof",
        preset: "read_only",
        operation: "write",
        allowed: false,
        reason: "read_only forbids write",
        policyVersion: 1,
      },
    ]);

    expect(explanation).toContain("resource_policy.protected_resource_violation");
    expect(explanation).toContain("/tmp/lynx-protected-proof");
    expect(explanation).toContain("read_only forbids write");
  });
});
