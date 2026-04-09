export interface GlobProtectedPathHit {
  token: string;
}

interface CandidateToken {
  token: string;
  obfuscated: boolean;
}

const GLOB_META_PATTERN = /[*?\[]/;
const DRIVE_PLACEHOLDER = "<drive>";
const MAX_STATIC_VARIANTS = 16;
const MAX_STATIC_DEPTH = 8;

const SYSTEM_AUTH_TARGETS = [
  ["etc", "passwd"],
  ["etc", "shadow"],
  ["etc", "sudoers"],
  [DRIVE_PLACEHOLDER, "windows", "system32", "config", "sam"],
  [DRIVE_PLACEHOLDER, "windows", "system32", "config", "security"],
  [DRIVE_PLACEHOLDER, "windows", "system32", "config", "system"],
];

const LYNX_PLUGIN_PREFIX = [".openclaw", "extensions", "openclaw-lynx-guardian"];
const GENERIC_GLOB_TOKEN_PATTERN = /[A-Za-z0-9_*?\[\].-]+(?:[\\/][A-Za-z0-9_*?\[\].-]+)*/g;

const PROTECTED_REFERENCE_TARGETS: Array<{
  label: string;
  components: string[];
  subpath?: boolean;
}> = [
  { label: "SOUL.md", components: ["soul.md"] },
  { label: "IDENTITY.md", components: ["identity.md"] },
  { label: "USER.md", components: ["user.md"] },
  { label: "AGENTS.md", components: ["agents.md"] },
  { label: "TOOLS.md", components: ["tools.md"] },
  { label: "SHIELD.md", components: ["shield.md"] },
  { label: "SKILL.md", components: ["skill.md"] },
  { label: "MEMORY.md", components: ["memory.md"] },
  { label: "memory/", components: ["memory"], subpath: true },
  { label: "workspace-state.json", components: ["workspace-state.json"] },
  { label: "openclaw.plugin.json", components: ["openclaw.plugin.json"] },
  { label: "openclaw.json", components: ["openclaw.json"] },
];

const PATH_FRAGMENT_PATTERNS = [
  /(?:~|\/)[^\s"'`|;&)]+/g,
  /[A-Za-z]:\\[^\s"'`|;&)]+/g,
  /\.[Oo]penclaw[\\/][^\s"'`|;&)]+/g,
];

const SHELL_ASSIGNMENT_PATTERN = /(?:^|[\s;&|])(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.+?)(?=$|[;&|])/g;
const CMD_SET_PATTERN = /(?:^|[\s;&|])set\s+([A-Za-z_][A-Za-z0-9_]*)=(.+?)(?=$|[;&|])/gi;
const POWERSHELL_ASSIGNMENT_PATTERN = /(?:^|[\s;&|])\$(?:env:)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)(?=$|[;&|])/g;

const VARIABLE_REFERENCE_PATTERN = /%([A-Za-z_][A-Za-z0-9_]*)%|\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$env:([A-Za-z_][A-Za-z0-9_]*)|\$([A-Za-z_][A-Za-z0-9_]*)/g;
const COMMAND_SUBSTITUTION_PATTERN = /\$\(([^()\r\n]+)\)|`([^`\r\n]+)`/;
const BRACE_EXPANSION_PATTERN = /\{([^{}\r\n]*,[^{}\r\n]*)\}/;

const BUILTIN_STATIC_VARIABLES = new Map<string, string>([
  ["SYSTEMROOT", "C:\\Windows"],
  ["WINDIR", "C:\\Windows"],
  ["HOME", "~"],
  ["USERPROFILE", "C:\\Users\\user"],
  ["HOMEDRIVE", "C:"],
  ["HOMEPATH", "\\Users\\user"],
]);

const PROTECTED_FRAGMENT_HINTS = new Set<string>([
  ...SYSTEM_AUTH_TARGETS.flat().filter((part) => part !== DRIVE_PLACEHOLDER),
  ...LYNX_PLUGIN_PREFIX,
  ...PROTECTED_REFERENCE_TARGETS.flatMap((target) => target.components),
]);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripWrapping(value: string): string {
  return value
    .replace(/^[("'`]+/, "")
    .replace(/[)"'`,;]+$/, "")
    .replace(/^[<>]+/, "")
    .replace(/[<>]+$/, "");
}

function normalizePathToken(value: string): string {
  return stripWrapping(value).replace(/\\/g, "/").replace(/\/+/g, "/");
}

function pathToComponents(value: string): string[] {
  return normalizePathToken(value)
    .split("/")
    .filter(Boolean)
    .map((part) => part.toLowerCase());
}

function globComponentToRegexSource(value: string): string {
  let source = "";

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "*") {
      source += "[^/]*";
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    if (char === "[") {
      const closeIndex = value.indexOf("]", index + 1);
      if (closeIndex !== -1) {
        source += "[^/]";
        index = closeIndex;
        continue;
      }
    }
    source += escapeRegex(char);
  }

  return source;
}

function componentCouldMatch(patternComponent: string, targetComponent: string): boolean {
  if (targetComponent === DRIVE_PLACEHOLDER) {
    const matcher = new RegExp(`^${globComponentToRegexSource(patternComponent)}$`, "i");
    for (let code = 97; code <= 122; code += 1) {
      if (matcher.test(String.fromCharCode(code) + ":")) {
        return true;
      }
    }
    return false;
  }

  const matcher = new RegExp(`^${globComponentToRegexSource(patternComponent)}$`, "i");
  return matcher.test(targetComponent);
}

function exactProtectedTargetMatch(pathToken: string, targetComponents: string[]): boolean {
  const candidateComponents = pathToComponents(pathToken);
  if (candidateComponents.length !== targetComponents.length) {
    return false;
  }

  return candidateComponents.every((component, index) =>
    componentCouldMatch(component, targetComponents[index]));
}

function protectedSubpathMatch(pathToken: string, protectedComponents: string[]): boolean {
  const candidateComponents = pathToComponents(pathToken);
  if (candidateComponents.length < protectedComponents.length) {
    return false;
  }

  for (let start = 0; start <= candidateComponents.length - protectedComponents.length; start += 1) {
    const matched = protectedComponents.every((component, index) =>
      componentCouldMatch(candidateComponents[start + index], component));
    if (matched) {
      return true;
    }
  }

  return false;
}

function collectPathLikeTokens(text: string): string[] {
  const tokens = new Set<string>();

  for (const pattern of PATH_FRAGMENT_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null = null;
    while ((match = pattern.exec(text)) !== null) {
      const token = normalizePathToken(match[0]);
      if (token) {
        tokens.add(token);
      }
    }
  }

  return [...tokens];
}

function collectGlobCandidateTokens(text: string): string[] {
  const tokens = new Set<string>(collectPathLikeTokens(text));

  GENERIC_GLOB_TOKEN_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null = null;
  while ((match = GENERIC_GLOB_TOKEN_PATTERN.exec(text)) !== null) {
    const token = normalizePathToken(match[0]);
    if (token) {
      tokens.add(token);
    }
  }

  return [...tokens];
}

function normalizeVariableName(name: string): string {
  return name.replace(/^env:/i, "").toUpperCase();
}

function collectRawAssignments(text: string): Map<string, string> {
  const assignments = new Map<string, string>();
  const patterns = [
    SHELL_ASSIGNMENT_PATTERN,
    CMD_SET_PATTERN,
    POWERSHELL_ASSIGNMENT_PATTERN,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null = null;
    while ((match = pattern.exec(text)) !== null) {
      assignments.set(normalizeVariableName(match[1]), match[2].trim());
    }
  }

  return assignments;
}

function looksLikeProtectedFragment(value: string): boolean {
  const normalized = normalizePathToken(value).toLowerCase();
  if (!normalized || normalized.length <= 1) {
    return false;
  }

  for (const hint of PROTECTED_FRAGMENT_HINTS) {
    if (normalized.includes(hint) || hint.includes(normalized)) {
      return true;
    }
  }

  return false;
}

function addLimitedResult(target: Set<string>, values: Iterable<string>): void {
  for (const value of values) {
    if (!value || target.size >= MAX_STATIC_VARIANTS) {
      return;
    }
    target.add(value);
  }
}

function resolveCommandSubstitution(
  body: string,
  assignments: Map<string, string>,
  depth: number,
  visitedVariables: Set<string>,
): string[] {
  if (depth > MAX_STATIC_DEPTH) {
    return [];
  }

  const outputs = new Set<string>();
  const bodyVariants = expandStaticTextVariants(body, assignments, depth + 1, visitedVariables);

  for (const variant of bodyVariants) {
    const trimmed = stripWrapping(variant).trim();
    const producerMatch = trimmed.match(/^(?:echo|printf|Write-Output)\s+(.+)$/i);
    if (producerMatch) {
      outputs.add(stripWrapping(producerMatch[1]).trim());
    }

    for (const token of collectGlobCandidateTokens(trimmed)) {
      if (looksLikeProtectedFragment(token)) {
        outputs.add(token);
      }
    }

    if (looksLikeProtectedFragment(trimmed)) {
      outputs.add(trimmed);
    }
  }

  return [...outputs].slice(0, MAX_STATIC_VARIANTS);
}

function resolveVariableValue(
  name: string,
  assignments: Map<string, string>,
  depth: number,
  visitedVariables: Set<string>,
): string[] {
  if (depth > MAX_STATIC_DEPTH) {
    return [];
  }

  const normalizedName = normalizeVariableName(name);
  if (visitedVariables.has(normalizedName)) {
    return [];
  }

  const rawValue = assignments.get(normalizedName);
  if (rawValue) {
    const nextVisited = new Set(visitedVariables);
    nextVisited.add(normalizedName);
    return expandStaticTextVariants(rawValue, assignments, depth + 1, nextVisited)
      .map((value) => stripWrapping(value).trim())
      .filter(Boolean);
  }

  if (BUILTIN_STATIC_VARIABLES.has(normalizedName)) {
    return [BUILTIN_STATIC_VARIABLES.get(normalizedName)!];
  }

  return [];
}

function findVariableReference(text: string): RegExpExecArray | null {
  VARIABLE_REFERENCE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null = null;

  while ((match = VARIABLE_REFERENCE_PATTERN.exec(text)) !== null) {
    const trailingText = text.slice(match.index + match[0].length);
    if (/^\s*=/.test(trailingText)) {
      continue;
    }
    return match;
  }

  return null;
}

function expandStaticTextVariants(
  text: string,
  assignments: Map<string, string>,
  depth = 0,
  visitedVariables = new Set<string>(),
): string[] {
  if (!text || depth > MAX_STATIC_DEPTH) {
    return [text];
  }

  const results = new Set<string>();

  const commandMatch = COMMAND_SUBSTITUTION_PATTERN.exec(text);
  if (commandMatch) {
    const body = commandMatch[1] ?? commandMatch[2] ?? "";
    const replacements = resolveCommandSubstitution(body, assignments, depth + 1, visitedVariables);
    if (replacements.length > 0) {
      for (const replacement of replacements) {
        addLimitedResult(
          results,
          expandStaticTextVariants(
            text.slice(0, commandMatch.index) + replacement + text.slice(commandMatch.index + commandMatch[0].length),
            assignments,
            depth + 1,
            visitedVariables,
          ),
        );
      }
      return [...results];
    }
  }

  const variableMatch = findVariableReference(text);
  if (variableMatch) {
    const variableName = variableMatch[1] ?? variableMatch[2] ?? variableMatch[3] ?? variableMatch[4] ?? "";
    const replacements = resolveVariableValue(variableName, assignments, depth + 1, visitedVariables);
    if (replacements.length > 0) {
      for (const replacement of replacements) {
        addLimitedResult(
          results,
          expandStaticTextVariants(
            text.slice(0, variableMatch.index) + replacement + text.slice(variableMatch.index + variableMatch[0].length),
            assignments,
            depth + 1,
            visitedVariables,
          ),
        );
      }
      return [...results];
    }
  }

  const braceMatch = BRACE_EXPANSION_PATTERN.exec(text);
  if (braceMatch) {
    const alternatives = braceMatch[1]
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (alternatives.length > 0) {
      for (const alternative of alternatives) {
        addLimitedResult(
          results,
          expandStaticTextVariants(
            text.slice(0, braceMatch.index) + alternative + text.slice(braceMatch.index + braceMatch[0].length),
            assignments,
            depth + 1,
            visitedVariables,
          ),
        );
      }
      return [...results];
    }
  }

  return [text];
}

function collectObfuscatedCandidateTokens(text: string): CandidateToken[] {
  const candidates = new Map<string, CandidateToken>();
  const assignments = collectRawAssignments(text);

  for (const token of collectGlobCandidateTokens(text)) {
    const normalized = normalizePathToken(token);
    if (!normalized) {
      continue;
    }
    candidates.set(normalized, { token: normalized, obfuscated: hasGlobMeta(normalized) });
  }

  const expandedVariants = expandStaticTextVariants(text, assignments);
  for (const variant of expandedVariants) {
    if (variant === text) {
      continue;
    }

    for (const token of collectGlobCandidateTokens(variant)) {
      const normalized = normalizePathToken(token);
      if (!normalized) {
        continue;
      }

      candidates.set(normalized, {
        token: normalized,
        obfuscated: true,
      });
    }
  }

  return [...candidates.values()];
}

export function hasGlobMeta(value: string): boolean {
  return GLOB_META_PATTERN.test(value);
}

export function findObfuscatedSystemAuthPath(text: string): GlobProtectedPathHit | null {
  for (const token of collectObfuscatedCandidateTokens(text)) {
    if (!token.obfuscated) {
      continue;
    }

    if (SYSTEM_AUTH_TARGETS.some((target) => exactProtectedTargetMatch(token.token, target))) {
      return { token: token.token };
    }
  }

  return null;
}

export function findObfuscatedLynxPluginPath(text: string): GlobProtectedPathHit | null {
  for (const token of collectObfuscatedCandidateTokens(text)) {
    if (!token.obfuscated) {
      continue;
    }

    if (protectedSubpathMatch(token.token, LYNX_PLUGIN_PREFIX)) {
      return { token: token.token };
    }
  }

  return null;
}

export function findObfuscatedProtectedReferenceLabels(text: string): string[] {
  const labels = new Set<string>();

  for (const token of collectObfuscatedCandidateTokens(text)) {
    if (!token.obfuscated) {
      continue;
    }

    for (const target of PROTECTED_REFERENCE_TARGETS) {
      const matched = target.subpath
        ? protectedSubpathMatch(token.token, target.components)
        : exactProtectedTargetMatch(token.token, target.components);
      if (matched) {
        labels.add(target.label);
      }
    }
  }

  return [...labels];
}
