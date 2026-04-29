# Self-Safety-Guard Concealed Intent Hardening Design

## Scope

This design applies only to the Lynx Guardian plugin in:

- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian`

It does not modify:

- OpenClaw core code in `D:\all-works\openclaw`
- the basic role split between `SX-security-audit` and `SX-self-safety-guard`
- existing `L4` instant deny behavior for unrelated hard boundaries such as plugin disable, immutable config mutation, or OpenClaw restart/stop
- unrelated approval transport logic
- unrelated output-side privacy and redaction logic

This design covers:

- how to learn from `SX-security-audit` without turning the audit layer into the runtime blocker
- how to strengthen `SX-self-safety-guard` so it understands concealed intent beyond plain keywords
- how to connect new concealed-intent signals into plugin runtime enforcement
- how to treat encoded, escaped, fragmented, confusable, invisible, and phonetic disguises as a first-class defense area
- how to preserve the current "single weak signal is not enough, high-confidence combinations directly deny" policy style

## Goal

Strengthen Lynx Guardian against requests that conceal malicious intent through encoding, escaping, Unicode tricks, invisible characters, fragmented wording, or similar disguise methods.

The target outcome is:

1. `SX-security-audit` remains the audit and evidence layer
2. `SX-self-safety-guard` becomes the reusable runtime defense rulebook for concealed intent
3. plugin code turns the same concealed-intent families into real `guardInput()` and `guardToolCall()` decisions
4. high-confidence combinations such as concealment plus explicit detector evasion, approval bypass, or execute sinks directly deny
5. weak single signals such as standalone `base64`, `unicode`, or `approval` help requests stay below deny
6. normal developer, education, i18n, and debugging questions do not get swept up as false positives

## Non-Goals

This phase does not:

- make the Python audit scanner the source of truth for runtime blocking
- run Python audit scripts inline on every user request
- convert every concealment signal into instant deny
- replace the current Chinese evasive-intent detector with a generic black-box heuristic engine
- broaden scope into OpenClaw core policy redesign
- treat all encoding, Unicode, or approval discussion as hostile by default

## Background

Lynx already has two distinct security roles:

- `SX-security-audit` inspects environment, files, dependencies, and skills, then returns audit findings and report material
- `SX-self-safety-guard` and the plugin guard path decide whether a live request should be allowed, warned, blocked, or denied

That split is correct and should stay in place.

The current gap is not that the audit layer is missing patterns. The gap is that some useful audit insights do not yet exist as reusable runtime concealment families with bounded deny rules.

Examples of the gap:

- the audit scanner can spot loader chains such as `powershell -enc`, `certutil -decode`, `fromCharCode(...)` plus `eval`, or compressed payload execution
- the runtime guard already understands some Chinese evasive intent, but it does not yet treat broader concealment methods as one explicit defense category
- this leaves room for requests that hide the same bypass goal behind Unicode escapes, URL encoding, invisible characters, confusable glyphs, staged text assembly, or mixed phonetic wording

The design answer is not to merge audit and runtime into one system. The answer is to share family names and policy semantics across three layers:

- audit
- self-safety skill
- plugin guard code

## Key Design Decision

Add one new shared defense concept: concealed intent.

Concealed intent means a request is trying to hide, fragment, or visually disguise its true meaning before asking for bypass, approval avoidance, detector evasion, or execution.

This design treats concealed intent as:

- a reusable security concept in `SX-self-safety-guard`
- a structured runtime signal family in plugin code
- a source of evidence and examples in `SX-security-audit`

It does not treat concealed intent as an automatic deny by itself.

### Policy boundary

- concealment alone: weak to medium signal, never sufficient for deny by itself
- concealment plus explicit high-risk runtime meaning: deny
- actual tool parameters or commands that already contain execution-grade loader patterns: can be handled more strictly than plain user text

Rationale:

- concealment raises risk, but normal developers also discuss encoding, Unicode, and parsing
- the deny boundary should stay anchored in meaning and action, not in isolated syntax
- the strongest evidence comes from combinations, not from one token

## Shared Concealed-Intent Taxonomy

All three layers should converge on the same family names even if their implementations differ.

Recommended top-level family:

- `intent_concealment`

Recommended runtime subfamilies:

- `encoding_escape`
- `glyph_confusable`
- `invisible_obfuscation`
- `fragmented_reassembly`
- `phonetic_disguise`
- `detector_evasion`
- `approval_bypass`
- `execute_sink`
- `staged_loader_chain`

### Family definitions

#### `encoding_escape`

Represents content hidden through reversible text encodings or escaped literal forms.

Examples:

- `base64`
- `hex`
- `16进制`
- `unicode escape`
- `\uXXXX`
- `\xXX`
- URL encoding
- HTML entity encoding
- `fromBase64String`
- `atob`

#### `glyph_confusable`

Represents visual disguise where characters look similar but are not the same code points.

Examples:

- full-width and half-width mixing
- Latin and Cyrillic lookalikes
- Greek lookalikes
- visually normal words assembled from multiple scripts

#### `invisible_obfuscation`

Represents hidden separators or rendering controls used to split risky meaning without obvious visible changes.

Examples:

- zero-width characters
- bidirectional override controls
- variant selectors used as separators
- invisible delimiters inserted between keyword fragments

#### `fragmented_reassembly`

Represents text or code that is intentionally broken apart and then reassembled.

Examples:

- spaced-out keywords
- punctuation-separated fragments
- string concatenation for risky tokens
- `chr()` chains
- `fromCharCode()` assembly
- staged "split first, join later, then run" wording

#### `phonetic_disguise`

Represents pinyin, initials, homophones, and mixed-language roots used to hide risky meaning.

Examples:

- `queren` for `确认`
- `shouquan` for `授权`
- `fengkong` for `风控`
- partial pinyin mixed with English and Chinese roots

#### `detector_evasion`

Represents meaning that tries to avoid recognition by Lynx, approval systems, scanners, detectors, or risk control.

Examples:

- hide from Lynx
- avoid detector recognition
- do not let risk control notice
- do not trigger scanning

#### `approval_bypass`

Represents attempts to skip confirmation, authorization, or approval flow.

Examples:

- do not show confirm
- do not ask for authorization
- pass approval automatically
- skip approval steps

#### `execute_sink`

Represents intent to run or feed the concealed payload into a real execution path.

Examples:

- execute after decoding
- feed into shell
- use `eval`, `exec`, `iex`, `function`, or similar sinks

#### `staged_loader_chain`

Represents multi-step concealment plus restore plus execution flow.

Examples:

- encode first, then send, then decode, then run
- compress, unpack, and execute
- split text, reassemble, and invoke

## Design 1: Keep Audit and Runtime Separate, but Share Families

`SX-security-audit` remains the audit layer.

Its responsibilities stay:

- discover suspicious scripts, loaders, and environment problems
- summarize findings
- provide report material for managed or manual audit flows

`SX-self-safety-guard` becomes the runtime defense rulebook for concealed intent.

Its responsibilities become:

- describe concealed-intent families in reusable language
- define high-confidence combinations
- document false-positive boundaries
- define short user-visible response principles without exposing internal detection detail

Plugin runtime code remains the enforcement layer.

Its responsibilities stay:

- normalize inputs
- detect runtime signals
- combine signals into score, severity, and action
- decide `allow`, `warn`, `block`, or `deny`

This avoids two failure modes:

- turning the audit scanner into the live request judge
- duplicating policy logic in three unrelated vocabularies

## Design 2: Upgrade `SX-self-safety-guard` into the Concealed-Intent Rulebook

The self-safety skill should not become a regex dump.

Instead it should be extended with four concrete sections.

### Section A: Concealed-intent family catalog

The skill should define:

- what each concealed-intent family means
- why it is risky
- which normal contexts are still allowed

### Section B: High-confidence runtime combinations

The skill should explicitly document combinations that justify deny or near-deny handling.

Recommended combinations:

- `intent_concealment` plus `detector_evasion`
- `intent_concealment` plus `approval_bypass`
- `intent_concealment` plus `execute_sink`
- `fragmented_reassembly` plus `staged_loader_chain`
- `encoding_escape` plus `execute_sink`
- `phonetic_disguise` plus approval or detector bypass semantics

### Section C: False-positive suppression examples

The skill should list examples that are normal and must not be denied just because they mention encoding or Unicode.

Required examples:

- asking how `base64` works in Python or JavaScript
- asking how Unicode escapes are parsed
- asking how zero-width or bidirectional characters break rendering
- asking how approval dialog configuration works in a normal enterprise workflow
- asking how `fromCharCode()` or `\uXXXX` syntax works in education or debugging contexts
- asking how to audit or detect concealment, rather than how to use it to bypass controls

### Section D: Response protocol

The skill should define:

- weak signals -> add risk or warn only
- medium combinations -> escalate risk and bias toward blocking
- high-confidence combinations -> deny
- user-visible explanations stay short and do not reveal exact matcher internals

## Design 3: Add a Dedicated Concealed-Intent Runtime Detector

Do not overload the current Chinese evasive-intent lexicon with every concealment mechanic.

Instead add a dedicated runtime detector module for concealment, then combine it with existing evasive-intent logic.

Recommended file shape:

- new guard module for concealment normalization and detection
- existing Chinese evasive-intent files continue to own domain wording such as bypass, approval, risk control, Lynx, and detector-target phrasing

This separation keeps responsibilities clear:

- concealment detector: how meaning is hidden
- evasive-intent detector: what risky meaning is being expressed

### Input detection model

The runtime should inspect both:

- original text
- normalized text

The original text is needed for:

- invisible characters
- bidirectional control characters
- script mixing and confusable glyph patterns

The normalized text is needed for:

- pinyin folding
- Unicode escape recovery
- width folding
- separated token collapse
- stable semantic matching

This is intentionally a dual-channel model:

- original form reveals concealment behavior
- normalized form reveals concealed meaning

## Design 4: Enforcement Strategy in `guardInput()`

`guardInput()` remains the primary natural-language decision point.

It should combine:

- existing Chinese evasive-intent families
- new concealed-intent families
- existing module scoring and level conversion

### Required `guardInput()` behavior

- single concealment signal does not deny
- concealment can increase score and severity
- concealment plus detector evasion can reach deny
- concealment plus approval bypass can reach deny
- concealment plus staged loader chain can reach deny
- concealment plus explicit execution sink can reach deny

### Recommended scoring style

Keep the current bounded, table-driven style:

- weak concealment only: low signal
- concealment plus one risky support family: medium
- concealment plus two or more risky support families: high
- explicit execution-grade chain: high to deny

This preserves the current repo preference for bounded combinations over broad unbounded heuristics.

## Design 5: Enforcement Strategy in `guardToolCall()`

`guardToolCall()` should become the second defense layer for operation-grade evidence.

This layer can be stricter because it sees actual command arguments and tool parameters instead of discussion text.

### Required operation-grade patterns

The runtime should recognize and elevate patterns such as:

- `powershell -enc`
- `pwsh -enc`
- `certutil -decode`
- `FromBase64String(...)`
- `atob(...)` followed by execution behavior
- `String.fromCharCode(...)` followed by `eval` or function creation
- decompression followed by `exec`, `eval`, `iex`, or shell execution
- repeated `chr()` assembly followed by execution

### Tool-call policy boundary

- purely descriptive or educational text does not reach this path as executable parameters
- actual tool parameters containing execution-grade loader chains may deny directly

This lets the plugin be more conservative at the action layer than at the discussion layer.

## Direct Deny Matrix

The recommended deny policy is:

| Signal state | Action |
|---|---|
| concealment only | do not deny |
| concealment plus explicit detector evasion goal | deny |
| concealment plus explicit approval bypass goal | deny |
| concealment plus execute sink | deny |
| concealment plus staged loader chain | deny |
| operation-grade loader chain in tool params | deny |

Notes:

- "explicit" means the request is not just naming the concept, but is asking to use concealment to evade detection, skip approval, or reach execution
- deny should continue to use short user-facing phrasing such as concealed bypass intent, concealed approval bypass, or concealed execution chain

## False-Positive Controls

The design must explicitly suppress false positives in at least these categories.

### Allowed topic families

- normal Base64, URL encoding, HTML entity, or Unicode help
- internationalization and rendering issues involving zero-width or bidirectional text
- approval-flow product configuration discussions
- education about `fromCharCode`, escape sequences, or parser behavior
- security analysis that explains how concealment is detected rather than asking how to use it to bypass controls

### Suppression principles

- harmless syntax discussion without bypass, approval avoidance, or execution intent stays below deny
- general debugging or i18n text issues stay below deny
- concealment signals must be interpreted in context, not as isolated blacklist hits

## Implementation Order

The implementation should happen in this order:

1. update `skills/lynx-guardian-lesson/SX-self-safety-guard/SKILL.md`
2. add the dedicated concealed-intent detector module in TypeScript
3. integrate the new detector into `guardInput()`
4. add operation-grade concealment checks into `guardToolCall()`
5. align family naming across audit, self-safety skill, tests, and logs
6. expand tests before widening runtime claims
7. run real sync and runtime validation after code changes

Rationale:

- the skill defines the policy language first
- the detector implementation comes next
- the runtime integration follows the approved policy language instead of inventing semantics during coding

## Validation Matrix

Validation must cover both positive and negative cases.

### A. Normalization tests

Required cases:

- full-width and half-width mixing
- zero-width insertion
- bidirectional control insertion
- `\uXXXX` and `\xXX` escape recovery
- URL-encoded fragments
- pinyin and mixed-language disguise
- spaced or punctuated token fragmentation

### B. Input-side positive cases

Required cases:

- concealment plus detector evasion
- concealment plus approval bypass
- concealment plus staged loader chain
- concealment plus execute sink
- Unicode-escaped or fragmented bypass requests that normalize into clear risky meaning

### C. Input-side negative cases

Required cases:

- normal encoding help
- normal Unicode and i18n help
- normal approval-flow configuration help
- normal educational discussion of parser or string-assembly syntax

### D. Tool-call positive cases

Required cases:

- `powershell -enc`
- `certutil -decode`
- `FromBase64String` into execution
- `fromCharCode` into `eval`
- decompression into `exec`, `eval`, or shell execution

### E. Tool-call negative cases

Required cases:

- benign encoding or decoding utilities
- benign parser demonstrations
- non-executing examples that mention the same APIs without a sink

### F. Runtime proof

Before claiming success:

- sync plugin changes into the real OpenClaw runtime
- verify health endpoint is live
- submit at least one concealed-intent prompt through a real runtime path
- confirm the visible refusal and the corresponding Lynx block log

## File Boundaries

Recommended file ownership:

- `skills/lynx-guardian-lesson/SX-self-safety-guard/SKILL.md`
  - policy language, concealed-intent families, false-positive boundaries, response rules
- existing Chinese evasive-intent files
  - domain wording for bypass, detector targets, approval-bypass language, and Chinese colloquial roots
- new concealed-intent detector module
  - normalization and concealment-family detection
- `src/guard/safety-guard.ts`
  - final composition into score, level, and action
- `guardToolCall()` path
  - operation-grade concealment and loader-chain enforcement
- `SX-security-audit`
  - audit examples, static discovery, and report material only

## Risks and Tradeoffs

### Risk 1: Over-normalization causes false positives

Mitigation:

- inspect original and normalized forms separately
- cap normalization passes
- require risky semantic support families before deny

### Risk 2: Copying audit regexes directly creates runtime brittleness

Mitigation:

- reuse concepts, not raw scanner rules
- keep runtime detection purpose-built for text and tool-parameter context

### Risk 3: Too many weak signals become heuristic sprawl

Mitigation:

- keep combination tables explicit
- prefer named family combinations over opaque score accumulation
- bound the effect of any one family

### Risk 4: Family naming drifts across skill, code, and tests

Mitigation:

- define one approved family list
- use the same names in docs, logs, and tests

## Success Criteria

This design is successful when:

1. concealed-intent families are documented once in `SX-self-safety-guard`
2. plugin runtime can detect concealed bypass meaning across encoded, escaped, invisible, fragmented, and phonetic forms
3. high-confidence combinations deny without turning ordinary encoding or Unicode discussion into collateral damage
4. tool-call enforcement can stop execution-grade loader chains more strictly than natural-language discussion
5. runtime proof shows the new logic works through a real OpenClaw path

## Implementation Gate

Do not begin implementation until the user reviews this spec and confirms that:

- concealed-intent family boundaries are correct
- deny combinations are strict enough without being too broad
- the implementation order is acceptable

Once the spec is approved, the next step is to write an implementation plan rather than coding ad hoc.
