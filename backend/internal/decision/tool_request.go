package decision

import (
	"fmt"
	"regexp"
	"sort"
	"strings"

	"github.com/openclaw/lynx-guardian/backend/internal/api"
)

type toolRequestView struct {
	Text              string
	ToolName          string
	ToolFamily        string
	OperationFamilies []string
	PathKinds         []string
	SourceKinds       []string
	SinkKinds         []string
	CommandFlags      []string
	NetworkTargets    []string
	Executables       []string
}

func buildToolRequestView(req api.DecisionRequest) toolRequestView {
	toolName := normalizeDecisionText(req.ToolName)
	text := normalizeDecisionText(strings.Join([]string{
		req.Content,
		req.ToolName,
		req.TargetURI,
		toolArgsFlatText(req.ToolArgs),
	}, " "))
	toolFamily := classifyToolFamily(toolName, text)
	pathKinds := classifyToolPathKinds(text)
	return toolRequestView{
		Text:              text,
		ToolName:          toolName,
		ToolFamily:        toolFamily,
		OperationFamilies: classifyToolOperations(toolName, text),
		PathKinds:         pathKinds,
		SourceKinds:       classifyToolSourceKinds(pathKinds, text),
		SinkKinds:         classifyToolSinkKinds(toolFamily, text),
		CommandFlags:      classifyToolCommandFlags(text),
		NetworkTargets:    extractNetworkTargets(text),
		Executables:       classifyToolExecutables(text),
	}
}

func toolArgsFlatText(args map[string]any) string {
	if len(args) == 0 {
		return ""
	}
	keys := make([]string, 0, len(args))
	for key := range args {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(args)*2)
	for _, key := range keys {
		parts = append(parts, key)
		parts = append(parts, flattenToolArgValue(args[key])...)
	}
	return normalizeDecisionText(strings.Join(parts, " "))
}

func classifyToolFamily(toolName string, text string) string {
	switch {
	case containsAny(toolName, "shell", "exec", "terminal") ||
		hasExecutable(text, "bash", "sh", "zsh", "cmd", "powershell", "pwsh"):
		return "shell"
	case containsAny(toolName, "read", "open_file", "view_file"):
		return "file_read"
	case containsAny(toolName, "write", "edit", "patch", "create_file", "save_file"):
		return "file_write"
	case containsAny(toolName, "http", "fetch", "network", "request") ||
		(containsAny(text, "http://", "https://") && hasExecutable(text, "curl", "wget")):
		return "network"
	case containsAny(toolName, "install") || containsAny(text, "npm install", "pip install", "go install", "cargo install", "skill install"):
		return "install"
	default:
		return "unknown"
	}
}

func classifyToolOperations(toolName string, text string) []string {
	ops := make([]string, 0)
	toolFamily := classifyToolFamily(toolName, text)
	if toolFamily == "file_read" || hasExecutable(text, "cat", "type", "head", "tail") || containsAny(text, "get-content", " read ") {
		ops = append(ops, "read")
	}
	if toolFamily == "file_write" || containsAny(text, " patch ", " write ", "edit_file", "set-content", "out-file", "tee ") ||
		containsAny(text, ">", "disabled") {
		ops = append(ops, "write")
	}
	if hasExecutable(text, "rm", "del", "rmdir") || containsAny(text, "remove-item", "delete", "unlink") {
		ops = append(ops, "delete")
	}
	if hasExecutable(text, "mv", "move", "rename") || containsAny(text, "move-item", "rename-item") {
		ops = append(ops, "move")
	}
	if hasExecutable(text, "chmod", "icacls") || containsAny(text, "set-acl") {
		ops = append(ops, "chmod")
	}
	if toolFamily == "shell" || hasAnyString(classifyToolExecutables(text), "python", "node", "go", "bash", "sh", "powershell", "pwsh", "cmd") {
		ops = append(ops, "execute")
	}
	if containsAny(text, "http://", "https://") && (hasExecutable(text, "curl", "wget") || containsAny(text, "invoke-webrequest", "iwr ")) {
		ops = append(ops, "network_fetch")
	}
	if containsAny(text, "http://", "https://") &&
		(containsAny(text, " post ", "-x post", "--data", "--data-binary", "upload", "@-") || containsAny(text, "invoke-restmethod")) {
		ops = append(ops, "network_send")
	}
	if toolFamily == "install" {
		ops = append(ops, "install")
	}
	if hasExecutable(text, "tar", "zip", "unzip", "7z", "gzip") {
		ops = append(ops, "archive")
	}
	if containsAny(text, "base64 -d", "base64 --decode", "frombase64string", "decode") {
		ops = append(ops, "decode")
	}
	if containsAny(text, " -enc ", "-encodedcommand", "tobase64string", "base64") {
		ops = append(ops, "encode")
	}
	if hasExecutable(text, "grep", "rg", "findstr") || containsAny(text, "select-string") {
		ops = append(ops, "search")
	}
	if hasExecutable(text, "ls", "dir") || containsAny(text, "get-childitem") {
		ops = append(ops, "list")
	}
	return uniqueStrings(ops)
}

func classifyToolPathKinds(text string) []string {
	kinds := make([]string, 0)
	if containsAny(text, "openclaw-lynx-guardian", "lynx guardian") {
		kinds = append(kinds, "plugin_self")
	}
	if containsAny(text, "openclaw.json", ".openclaw/config", "config.toml", "provider-config", "gateway-config") {
		kinds = append(kinds, "openclaw_config")
	}
	if containsAny(text, ".openclaw/hooks", "/hooks/", "\\hooks\\") {
		kinds = append(kinds, "hook")
	}
	if containsAny(text, ".openclaw/skills", "/skills/", "\\skills\\", "skill.md", "skill.json") {
		kinds = append(kinds, "skill")
	}
	if containsAny(text, ".env", "private key", "api_key", "api key", "token", "credential", "secret") {
		kinds = append(kinds, "secret")
	}
	if containsAny(text, "id_rsa", "id_ed25519", ".ssh/", "\\.ssh\\", "private key") {
		kinds = append(kinds, "ssh_key")
	}
	if containsAny(text, ".env") {
		kinds = append(kinds, "env_file")
	}
	if containsAny(text, "system prompt", "developer instruction", "prompt.md", "prompts/", "\\prompts\\") {
		kinds = append(kinds, "prompt_file")
	}
	if containsAny(text, "/etc/", "/usr/bin", "/bin/", "c:/windows", "c:\\windows", "system32") {
		kinds = append(kinds, "system_path")
	}
	if containsAny(text, "src/", "src\\", "backend/", "backend\\", "frontend/", "frontend\\", "package.json", "go.mod", "./internal/") {
		kinds = append(kinds, "project_source")
	}
	if containsAny(text, "c:/users/", "c:\\users\\", "/home/", "~/", "$home") {
		kinds = append(kinds, "user_home")
	}
	if containsAny(text, "/tmp/", "c:/temp", "c:\\temp", "appdata/local/temp", "$env:temp") {
		kinds = append(kinds, "temp")
	}
	return uniqueStrings(kinds)
}

func classifyToolSourceKinds(pathKinds []string, text string) []string {
	sources := make([]string, 0)
	if hasAnyString(pathKinds, "secret", "ssh_key", "env_file") {
		sources = append(sources, "secret")
	}
	if hasAnyString(pathKinds, "prompt_file") {
		sources = append(sources, "protected_prompt")
	}
	if hasAnyString(pathKinds, "plugin_self", "openclaw_config", "hook", "skill") {
		sources = append(sources, "plugin_file")
	}
	if containsAny(text, "taint", "payload.txt", "artifact") {
		sources = append(sources, "tainted_artifact")
	}
	if hasAnyString(pathKinds, "user_home", "project_source", "temp") {
		sources = append(sources, "user_file")
	}
	if containsAny(text, "base64", "encoded", "generate payload", "payload") {
		sources = append(sources, "generated_payload")
	}
	return uniqueStrings(sources)
}

func classifyToolSinkKinds(toolFamily string, text string) []string {
	sinks := make([]string, 0)
	if containsAny(text, "http://", "https://") &&
		(containsAny(text, "post", "upload", "--data", "--data-binary", "@-") || hasExecutable(text, "curl", "wget")) {
		sinks = append(sinks, "external_network")
	}
	if containsAny(text, "clipboard", "pbcopy", "clip.exe", "set-clipboard") {
		sinks = append(sinks, "clipboard")
	}
	if containsAny(text, "chat output", "assistant_output", "send message", "ctx.sendmessage") {
		sinks = append(sinks, "chat_output")
	}
	if toolFamily == "file_write" || containsAny(text, ">", "set-content", "out-file", "tee ") {
		sinks = append(sinks, "file_write")
	}
	if toolFamily == "shell" || hasAnyString(classifyToolExecutables(text), "python", "node", "go", "bash", "sh", "powershell", "pwsh", "cmd") {
		sinks = append(sinks, "process_exec")
	}
	if toolFamily == "install" || containsAny(text, "npm install", "pip install", "go install", "cargo install", "skill install") {
		sinks = append(sinks, "package_install")
	}
	if len(sinks) == 0 && toolFamily == "unknown" {
		sinks = append(sinks, "unknown")
	}
	return uniqueStrings(sinks)
}

func classifyToolCommandFlags(text string) []string {
	flags := make([]string, 0)
	if containsAny(text, " -enc ", "-encodedcommand", "frombase64string", "iex ") ||
		(containsAny(text, "base64") && containsAny(text, "bash", "sh", "powershell", "cmd", "python", "node")) {
		flags = append(flags, "encoded_execution")
	}
	if containsAny(text, "|", "&&", "||", ";") {
		flags = append(flags, "shell_pipeline")
	}
	if hasDownloadExecute(text) {
		flags = append(flags, "download_execute")
	}
	if containsAny(text, "rm -rf", "rm -fr", "remove-item") && containsAny(text, "-recurse", "-force", " -r", "-f") ||
		containsAny(text, "rmdir /s", "del /s") {
		flags = append(flags, "recursive_delete")
	}
	if containsAny(text, "chmod 777", "chmod -r 777", "icacls") && containsAny(text, "everyone", ":f", "full", "777") {
		flags = append(flags, "permission_weakening")
	}
	if containsAny(text, "history -c", "clear-history", ".bash_history", "consolehost_history") {
		flags = append(flags, "history_cleanup")
	}
	if wildcardMutationPattern.MatchString(text) {
		flags = append(flags, "wildcard_mutation")
	}
	if containsAny(text, "nohup", "start-process", "--detach", " disown", " &") {
		flags = append(flags, "background_execution")
	}
	if containsAny(text, " --quiet", " -q", "> /dev/null", "2>&1", "hidden", "silent") {
		flags = append(flags, "silent_mode")
	}
	if containsAny(text, "\"disabled\":true", "'disabled':true", "disabled true", "disable plugin", "disable safety", "enabled false") {
		flags = append(flags, "config_disable")
	}
	return uniqueStrings(flags)
}

func extractNetworkTargets(text string) []string {
	matches := urlHostPattern.FindAllStringSubmatch(text, -1)
	targets := make([]string, 0, len(matches))
	for _, match := range matches {
		if len(match) < 2 {
			continue
		}
		host := strings.Trim(match[1], ".,;:'\")]}>\n\r\t")
		if host != "" {
			targets = append(targets, host)
		}
	}
	return uniqueStrings(targets)
}

func classifyToolExecutables(text string) []string {
	executables := make([]string, 0)
	for _, exe := range knownToolExecutables {
		if hasExecutable(text, exe) {
			executables = append(executables, exe)
		}
	}
	return uniqueStrings(executables)
}

func hasAnyString(values []string, wants ...string) bool {
	for _, value := range values {
		for _, want := range wants {
			if value == want {
				return true
			}
		}
	}
	return false
}

var (
	urlHostPattern          = regexp.MustCompile(`https?://([^/\s'"<>)]+)`)
	wildcardMutationPattern = regexp.MustCompile(`(?i)(^|[\s|;&])(rm|del|move|mv|chmod|icacls)\s+[^|;&]*(\*|\?\.)`)
	commandTokenPattern     = regexp.MustCompile(`[a-z0-9_.-]+`)
)

var knownToolExecutables = []string{
	"bash",
	"cat",
	"cmd",
	"curl",
	"del",
	"dir",
	"go",
	"grep",
	"head",
	"ls",
	"node",
	"powershell",
	"pwsh",
	"python",
	"rg",
	"rm",
	"sh",
	"tail",
	"wget",
}

func flattenToolArgValue(value any) []string {
	switch typed := value.(type) {
	case nil:
		return nil
	case string:
		return []string{typed}
	case []any:
		parts := make([]string, 0, len(typed))
		for _, item := range typed {
			parts = append(parts, flattenToolArgValue(item)...)
		}
		return parts
	case map[string]any:
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		parts := make([]string, 0, len(typed)*2)
		for _, key := range keys {
			parts = append(parts, key)
			parts = append(parts, flattenToolArgValue(typed[key])...)
		}
		return parts
	default:
		return []string{fmt.Sprint(typed)}
	}
}

func hasExecutable(text string, executables ...string) bool {
	tokens := commandTokenPattern.FindAllString(strings.ToLower(text), -1)
	for _, executable := range executables {
		want := strings.TrimSuffix(strings.ToLower(executable), ".exe")
		for _, token := range tokens {
			if strings.TrimSuffix(token, ".exe") == want {
				return true
			}
		}
	}
	return false
}

func hasDownloadExecute(text string) bool {
	if !containsAny(text, "http://", "https://") {
		return false
	}
	if containsAny(text, "| sh", "| bash", "| powershell", "| pwsh", "| python", "| node", "iex ", "invoke-expression") {
		return true
	}
	return (hasExecutable(text, "curl") || hasExecutable(text, "wget")) &&
		containsAny(text, " -o-", "-qo-", "--output-document=-") &&
		hasAnyString(classifyToolExecutables(text), "bash", "sh", "powershell", "pwsh", "python", "node")
}
