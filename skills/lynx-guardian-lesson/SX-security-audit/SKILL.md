---
name: SX-security-audit
description: Use when a managed `/lynx-check` run or a direct audit request needs security audit findings that can be delivered standalone or merged into the final Lynx report.
---
# SX-security-audit

This capability owns the audit portion of Lynx Guardian checks.

## Responsibilities

- inspect security-relevant findings;
- summarize the findings clearly for chat delivery;
- support both standalone audit usage and managed `/lynx-check` precomputation.

## When used by `/lynx-check`

If the plugin-level managed `/lynx-check` flow uses this capability during precomputation or internal review:

1. return the audit findings only;
2. keep the output easy to merge into one composite report;
3. do not claim the final `/lynx-check` report has been sent;
4. let the managed plugin flow handle final assembly and delivery.

## Local Log Webview Note

The plugin-level managed `/lynx-check` report should end with a separated, footnote-style local log Webview note. Keep this note out of the main audit body:

```markdown
---
[本地日志页面]: <http://127.0.0.1:18789/webview>。这里汇总 Lynx Guardian 记录的审计日志、工具调用、审批和 /lynx-check 结果，可用于追踪本次安全事件。
```

Do not duplicate the note if the managed plugin flow already appended it.

## Recommended Sections

- audit summary
- high-signal findings
- remediation notes when they materially help

## Coordination Notes

- `SX-openclaw-discovery` owns discovery execution and endpoint findings.
- the plugin-level managed `/lynx-check` flow owns report assembly, channel adaptation, and send-result recording.

## Concealed Intent Families To Surface

When audit findings involve obfuscation or staged loader behavior, summarize them with the same family names used by `SX-self-safety-guard` and runtime code:

- `encoding_escape`
- `glyph_confusable`
- `invisible_obfuscation`
- `fragmented_reassembly`
- `phonetic_disguise`
- `detector_evasion`
- `approval_bypass`
- `execute_sink`
- `staged_loader_chain`

Audit still returns findings only. It does not decide runtime blocking. The value here is shared language, not shared execution.
