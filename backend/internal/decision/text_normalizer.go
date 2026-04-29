package decision

import (
	"regexp"
	"strings"
)

type textNormalizationRule struct {
	from *regexp.Regexp
	to   string
}

var decisionTextNormalizations = []textNormalizationRule{
	{regexp.MustCompile(`[\x{200B}-\x{200D}\x{FEFF}]`), ""},
	{regexp.MustCompile(`　`), " "},
	{regexp.MustCompile(`(?i)Ｌｙｎｘ|ＬＹＮＸ|ｌｙｎｘ`), "lynx"},
	{regexp.MustCompile(`(?i)灵克斯|林克斯`), "lynx"},
	{regexp.MustCompile(`(?i)(^|[^a-z])(?:lin|ling)[\s_-]*ke[\s_-]*si([^a-z]|$)`), "${1}lynx${2}"},
	{regexp.MustCompile(`(?i)(^|[^a-z])feng[\s_-]*kong([^a-z]|$)`), "${1}风控${2}"},
	{regexp.MustCompile(`(?i)(^|[^a-z])shen[\s_-]*pi([^a-z]|$)`), "${1}审批${2}"},
	{regexp.MustCompile(`(?i)(^|[^a-z])que[\s_-]*ren([^a-z]|$)`), "${1}确认${2}"},
	{regexp.MustCompile(`(?i)(^|[^a-z])shou[\s_-]*quan([^a-z]|$)`), "${1}授权${2}"},
	{regexp.MustCompile(`(?i)(^|[^a-z])rao[\s_-]*guo([^a-z]|$)`), "${1}绕过${2}"},
	{regexp.MustCompile(`(?i)(^|[^a-z])gai[\s_-]*ming([^a-z]|$)`), "${1}改名${2}"},
	{regexp.MustCompile(`(?i)(^|[^a-z])chong[\s_-]*ming[\s_-]*ming([^a-z]|$)`), "${1}重命名${2}"},
	{regexp.MustCompile(`(?i)(^|[^a-z])tong[\s_-]*pei[\s_-]*fu([^a-z]|$)`), "${1}通配符${2}"},
	{regexp.MustCompile(`(?i)(^|[^a-z])jing[\s_-]*mo([^a-z]|$)`), "${1}静默${2}"},
	{regexp.MustCompile(`(?i)(^|[^a-z])liu[\s_-]*hen([^a-z]|$)`), "${1}留痕${2}"},
	{regexp.MustCompile(`(?i)(^|[^a-z])luo[\s_-]*di[\s_-]*zhi[\s_-]*xing([^a-z]|$)`), "${1}落地执行${2}"},
	{regexp.MustCompile(`(?i)lynx\s+guardian`), "lynx插件"},
	{regexp.MustCompile(`(?i)lynx\s+插件`), "lynx插件"},
	{regexp.MustCompile(`\s+`), " "},
}

var (
	spaceBeforePunctuation = regexp.MustCompile(`\s+([,，。！？])`)
	hanSeparatedBySpace    = regexp.MustCompile(`([\p{Han}])\s+([\p{Han}])`)
)

func normalizeDecisionText(text string) string {
	normalized := strings.TrimSpace(normalizeFullwidthASCII(text))
	for _, rule := range decisionTextNormalizations {
		normalized = rule.from.ReplaceAllString(normalized, rule.to)
	}
	normalized = strings.ReplaceAll(normalized, "重命名", "改名")
	normalized = spaceBeforePunctuation.ReplaceAllString(normalized, "$1")
	normalized = strings.ToLower(strings.TrimSpace(normalized))
	normalized = strings.ReplaceAll(normalized, " lynx插件", "lynx插件")
	normalized = collapseHanSpaces(normalized)
	return normalized
}

func normalizeFullwidthASCII(text string) string {
	return strings.Map(func(r rune) rune {
		if r >= '！' && r <= '～' {
			return r - '！' + '!'
		}
		return r
	}, text)
}

func collapseHanSpaces(text string) string {
	for {
		next := hanSeparatedBySpace.ReplaceAllString(text, "$1$2")
		if next == text {
			return next
		}
		text = next
	}
}
