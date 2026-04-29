# Lynx Check Composite Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/lynx-check` return a stable composite report that always includes public exposure, malicious script scan, skill integrity verification, and service discovery, with the IP/port discovery section rendered last.

**Architecture:** Keep the existing hook entrypoint in `index.ts`, but move manual-check aggregation into focused helper code under `src/`. The hook will build one combined report string, persist it to the existing discovery temp file, and let `before_message_write` append it to the final assistant output.

**Tech Stack:** TypeScript, Vitest, NodeNext ESM, existing OpenClaw plugin hooks

---

### Task 1: Lock the desired `/lynx-check` behavior with a failing test

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\plugin.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('should append a composite /lynx-check report with discovery last', async () => {
  setup(mockApi);
  const handler = handlers['before_agent_start'];

  const result = await handler(
    { prompt: '[2026-03-30 14:00:00] /lynx-check' },
    { sessionKey: 'sess-composite-check' },
  );

  expect(result).toEqual(
    expect.objectContaining({
      prependContext: expect.stringContaining('完整报告将由插件自动附加'),
    }),
  );

  const report = readFileSync(pendingDiscoveryPath, 'utf8');
  expect(report).toContain('公网暴露检测');
  expect(report).toContain('恶意脚本扫描');
  expect(report).toContain('Skill 完整性校验');
  expect(report).toContain('服务发现 IP/端口');
  expect(report.lastIndexOf('服务发现 IP/端口')).toBeGreaterThan(report.lastIndexOf('Skill 完整性校验'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/plugin.test.ts --testNamePattern "composite /lynx-check report"`
Expected: FAIL because the current implementation writes only the discovery report body.

- [ ] **Step 3: Write minimal implementation**

```ts
const manualReport = await runManualLynxCheck(...);
writeFileSync(DISCOVERY_RESULT_PATH, manualReport, "utf8");
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/plugin.test.ts --testNamePattern "composite /lynx-check report"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/plugin.test.ts src/manual-lynx-check.ts index.ts
git commit -m "feat: aggregate lynx check report"
```

### Task 2: Implement a composite report builder with focused section ordering

**Files:**
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\manual-lynx-check.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\discovery-hook-utils.ts`

- [ ] **Step 1: Write the failing helper test**

```ts
it('builds sections in the expected order', async () => {
  const report = await buildManualLynxCheckReport(...);
  expect(report).toContain('公网暴露检测');
  expect(report).toContain('恶意脚本扫描');
  expect(report).toContain('Skill 完整性校验');
  expect(report).toContain('服务发现 IP/端口');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/hook-helpers.test.ts --testNamePattern "expected order"`
Expected: FAIL because the helper does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export async function buildManualLynxCheckReport(...) {
  const sections = [
    formatPublicExposureSection(...),
    formatMaliciousScriptSection(...),
    formatSkillIntegritySection(...),
    formatDiscoverySection(...),
  ];
  return sections.filter(Boolean).join("\n\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/hook-helpers.test.ts --testNamePattern "expected order"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/manual-lynx-check.ts test/hook-helpers.test.ts src/discovery-hook-utils.ts
git commit -m "feat: add manual lynx check aggregation helpers"
```

### Task 3: Wire the composite report into the existing hook flow and verify

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\index.ts`
- Test: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\plugin.test.ts`

- [ ] **Step 1: Update the hook to use the new report builder**

```ts
if (isManualDiscoveryRequest(userInput)) {
  const result = await runManualLynxCheck(...);
  writeFileSync(DISCOVERY_RESULT_PATH, result, "utf8");
  prependContext += "[系统指令] ...";
}
```

- [ ] **Step 2: Run focused regression tests**

Run: `npx vitest run test/plugin.test.ts --testNamePattern "before_message_write|discovery report|gateway_start|composite /lynx-check report"`
Expected: PASS

- [ ] **Step 3: Run helper tests**

Run: `npx vitest run test/hook-helpers.test.ts`
Expected: PASS

- [ ] **Step 4: Run build**

Run: `node scripts/build.js`
Expected: Build succeeds and emits updated dist bundle.

- [ ] **Step 5: Commit**

```bash
git add index.ts src/manual-lynx-check.ts test/plugin.test.ts test/hook-helpers.test.ts
git commit -m "feat: make lynx check return composite report"
```
