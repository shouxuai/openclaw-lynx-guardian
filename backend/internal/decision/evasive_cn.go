package decision

import (
	"regexp"
)

type evasiveLiteral struct {
	family               string
	term                 string
	weight               float64
	requiresCooccurrence bool
}

type evasivePattern struct {
	family               string
	pattern              *regexp.Regexp
	label                string
	weight               float64
	requiresCooccurrence bool
}

var chineseEvasiveIntentLiterals = []evasiveLiteral{
	{family: "bypass_goal", term: "绕过", weight: 2},
	{family: "bypass_goal", term: "避开检测", weight: 2},
	{family: "bypass_goal", term: "不要被识别", weight: 2},
	{family: "bypass_goal", term: "跳过审批", weight: 2},
	{family: "bypass_goal", term: "欺骗风控", weight: 2},
	{family: "bypass_goal", term: "躲开检查", weight: 2},
	{family: "bypass_goal", term: "蒙混过去", weight: 2, requiresCooccurrence: true},
	{family: "bypass_goal", term: "糊弄过去", weight: 2, requiresCooccurrence: true},
	{family: "bypass_goal", term: "别让它看出来", weight: 1, requiresCooccurrence: true},
	{family: "masquerade_method", term: "改名", weight: 1, requiresCooccurrence: true},
	{family: "masquerade_method", term: "伪装", weight: 2},
	{family: "masquerade_method", term: "冒充", weight: 2},
	{family: "masquerade_method", term: "伪装成正常更新", weight: 2},
	{family: "masquerade_method", term: "像正常脚本", weight: 1, requiresCooccurrence: true},
	{family: "masquerade_method", term: "披个马甲", weight: 2, requiresCooccurrence: true},
	{family: "masquerade_method", term: "套壳", weight: 2, requiresCooccurrence: true},
	{family: "masquerade_method", term: "换个壳", weight: 2, requiresCooccurrence: true},
	{family: "masquerade_method", term: "换皮", weight: 1, requiresCooccurrence: true},
	{family: "wildcard_obfuscation", term: "通配符", weight: 1},
	{family: "wildcard_obfuscation", term: "星号通配", weight: 1},
	{family: "wildcard_obfuscation", term: "分段拼接", weight: 1, requiresCooccurrence: true},
	{family: "wildcard_obfuscation", term: "拆开字符串", weight: 1, requiresCooccurrence: true},
	{family: "wildcard_obfuscation", term: "间插符号", weight: 1, requiresCooccurrence: true},
	{family: "wildcard_obfuscation", term: "模糊匹配", weight: 1, requiresCooccurrence: true},
	{family: "wildcard_obfuscation", term: "打散关键字", weight: 1, requiresCooccurrence: true},
	{family: "wildcard_obfuscation", term: "拼起来", weight: 1, requiresCooccurrence: true},
	{family: "wildcard_obfuscation", term: "拆词", weight: 1, requiresCooccurrence: true},
	{family: "encoding_obfuscation", term: "base64", weight: 1, requiresCooccurrence: true},
	{family: "encoding_obfuscation", term: "b64decode", weight: 1, requiresCooccurrence: true},
	{family: "encoding_obfuscation", term: "16进制", weight: 1, requiresCooccurrence: true},
	{family: "encoding_obfuscation", term: "hex", weight: 1, requiresCooccurrence: true},
	{family: "encoding_obfuscation", term: "unicode转义", weight: 1, requiresCooccurrence: true},
	{family: "encoding_obfuscation", term: "url编码", weight: 1, requiresCooccurrence: true},
	{family: "encoding_obfuscation", term: "fromcharcode", weight: 1, requiresCooccurrence: true},
	{family: "encoding_obfuscation", term: "chr拼接", weight: 1, requiresCooccurrence: true},
	{family: "encoding_obfuscation", term: "frombase64string", weight: 1, requiresCooccurrence: true},
	{family: "detector_target", term: "风控", weight: 2},
	{family: "detector_target", term: "审批", weight: 1},
	{family: "detector_target", term: "识别", weight: 1},
	{family: "detector_target", term: "插件检测", weight: 2},
	{family: "detector_target", term: "lynx插件", weight: 2},
	{family: "approval_evasion", term: "别弹确认框", weight: 1, requiresCooccurrence: true},
	{family: "approval_evasion", term: "别要授权", weight: 1, requiresCooccurrence: true},
	{family: "approval_evasion", term: "不要确认", weight: 1, requiresCooccurrence: true},
	{family: "approval_evasion", term: "不要授权", weight: 1, requiresCooccurrence: true},
	{family: "approval_evasion", term: "直接过审批", weight: 2, requiresCooccurrence: true},
	{family: "approval_evasion", term: "自动放行", weight: 2, requiresCooccurrence: true},
	{family: "approval_evasion", term: "免审批", weight: 2, requiresCooccurrence: true},
	{family: "approval_evasion", term: "跳过授权", weight: 2, requiresCooccurrence: true},
	{family: "dangerous_outcome", term: "提权", weight: 2},
	{family: "dangerous_outcome", term: "落地执行", weight: 2},
	{family: "dangerous_outcome", term: "删除数据", weight: 2},
	{family: "dangerous_outcome", term: "关闭安全防护", weight: 2},
	{family: "dangerous_outcome", term: "批量导出敏感内容", weight: 2},
	{family: "dangerous_outcome", term: "敏感命令", weight: 1, requiresCooccurrence: true},
	{family: "staged_attack", term: "分步执行", weight: 1, requiresCooccurrence: true},
	{family: "staged_attack", term: "一步一步", weight: 1, requiresCooccurrence: true},
	{family: "staged_attack", term: "拆成多步", weight: 1, requiresCooccurrence: true},
	{family: "staged_attack", term: "逐步绕过", weight: 2},
	{family: "staged_attack", term: "先A后B", weight: 1, requiresCooccurrence: true},
	{family: "stealth_intent", term: "静默执行", weight: 2},
	{family: "stealth_intent", term: "不弹窗", weight: 1},
	{family: "stealth_intent", term: "不报警", weight: 2},
	{family: "stealth_intent", term: "无提示", weight: 1},
	{family: "stealth_intent", term: "不要留痕", weight: 2},
	{family: "stealth_intent", term: "别触发告警", weight: 2, requiresCooccurrence: true},
	{family: "stealth_intent", term: "悄悄跑", weight: 1, requiresCooccurrence: true},
}

var chineseEvasiveIntentPatterns = []evasivePattern{
	{family: "bypass_goal", pattern: regexp.MustCompile(`(?i)(?:绕过|避开|跳过).{0,10}(?:检测|风控|审批|识别)`), label: "bypass_or_evade_detector", weight: 2},
	{family: "bypass_goal", pattern: regexp.MustCompile(`(?i)(?:不要|别).{0,6}(?:被|给).{0,6}(?:检测|发现|识别)`), label: "not_detected_intent", weight: 2},
	{family: "bypass_goal", pattern: regexp.MustCompile(`(?i)(?:别让|不要让).{0,8}(?:lynx插件|风控|审批|检测器|识别引擎).{0,8}(?:看出来|发现|识别出来|盯上)`), label: "dont_let_guard_notice", weight: 2},
	{family: "bypass_goal", pattern: regexp.MustCompile(`(?i)(?:蒙混|糊弄).{0,6}(?:过去|过关)`), label: "colloquial_slip_through", weight: 1, requiresCooccurrence: true},
	{family: "masquerade_method", pattern: regexp.MustCompile(`(?i)(?:改名|伪装|冒充).{0,12}(?:exe|脚本|二进制|文件)`), label: "rename_fake_binary", weight: 2},
	{family: "masquerade_method", pattern: regexp.MustCompile(`(?i)(?:装成|伪装成).{0,10}(?:正常|白名单|安全).{0,8}(?:流程|工具|更新)`), label: "pretend_normal_workflow", weight: 1, requiresCooccurrence: true},
	{family: "masquerade_method", pattern: regexp.MustCompile(`(?i)(?:披个马甲|套壳|换个壳|换皮).{0,10}(?:脚本|工具|程序|更新|命令)?`), label: "colloquial_masquerade", weight: 1, requiresCooccurrence: true},
	{family: "wildcard_obfuscation", pattern: regexp.MustCompile(`(?i)(?:模式匹配|模糊匹配).{0,12}(?:绕过|避开|隐藏)`), label: "wildcard_or_pattern_hiding", weight: 1, requiresCooccurrence: true},
	{family: "wildcard_obfuscation", pattern: regexp.MustCompile(`(?i)(?:通配符|星号通配)`), label: "standalone_wildcard_discussion", weight: 1},
	{family: "wildcard_obfuscation", pattern: regexp.MustCompile(`(?i)(?:拆开|分段|拼接).{0,12}(?:字符串|命令|参数).{0,10}(?:检测|识别)`), label: "split_concat_obfuscation", weight: 2},
	{family: "wildcard_obfuscation", pattern: regexp.MustCompile(`(?i)(?:打散|拼起来|拆词).{0,10}(?:关键字|参数|命令|字符串)`), label: "scatter_or_concat_keywords", weight: 1, requiresCooccurrence: true},
	{family: "encoding_obfuscation", pattern: regexp.MustCompile(`(?i)(?:base64|b64decode|frombase64string|certutil\s+-decode|powershell(?:\.exe)?\s+-enc|pwsh(?:\.exe)?\s+-enc).{0,20}(?:执行|运行|喂进去|绕过|避开|检测|识别|审批|风控)`), label: "encoded_loader_bypass", weight: 2, requiresCooccurrence: true},
	{family: "encoding_obfuscation", pattern: regexp.MustCompile(`(?i)(?:hex|16进制|unicode转义|url编码|fromcharcode|chr\s*\().{0,20}(?:拆开|拼接|隐藏|绕过|避开|检测|识别)`), label: "encoded_split_obfuscation", weight: 1, requiresCooccurrence: true},
	{family: "encoding_obfuscation", pattern: regexp.MustCompile(`(?i)(?:先|用).{0,8}(?:base64|hex|16进制|unicode转义|url编码).{0,12}(?:一下|一层|包一层).{0,10}(?:再|后).{0,10}(?:喂进去|执行|运行|发出去)`), label: "encode_then_execute", weight: 1, requiresCooccurrence: true},
	{family: "detector_target", pattern: regexp.MustCompile(`(?i)(?:lynx插件|风控|审批|检测器|插件|识别引擎)`), label: "explicit_guard_target", weight: 1},
	{family: "detector_target", pattern: regexp.MustCompile(`(?i)(?:针对|对付).{0,10}(?:插件|审批|风控|识别)`), label: "target_guard_component", weight: 2},
	{family: "approval_evasion", pattern: regexp.MustCompile(`(?i)(?:别|不要).{0,6}(?:弹|出).{0,6}(?:确认|授权).{0,4}(?:框|窗)?`), label: "skip_confirmation_prompt", weight: 1, requiresCooccurrence: true},
	{family: "approval_evasion", pattern: regexp.MustCompile(`(?i)(?:别要|不要).{0,6}(?:授权|确认)`), label: "avoid_authorization_prompt", weight: 1, requiresCooccurrence: true},
	{family: "approval_evasion", pattern: regexp.MustCompile(`(?i)(?:直接|自动).{0,8}(?:过|通过|放行).{0,6}(?:审批|授权|确认)`), label: "auto_approval_bypass", weight: 2, requiresCooccurrence: true},
	{family: "approval_evasion", pattern: regexp.MustCompile(`(?i)(?:免|跳过|绕过|不走).{0,6}(?:审批|授权|确认)`), label: "skip_approval_step", weight: 2, requiresCooccurrence: true},
	{family: "dangerous_outcome", pattern: regexp.MustCompile(`(?i)(?:提权|落地执行|关闭防护|删除数据|外传敏感).{0,8}(?:成功|完成|可以)?`), label: "high_risk_action_outcome", weight: 2},
	{family: "dangerous_outcome", pattern: regexp.MustCompile(`(?i)(?:高风险|危险).{0,8}(?:操作|命令|执行)`), label: "execute_dangerous_operation", weight: 1, requiresCooccurrence: true},
	{family: "staged_attack", pattern: regexp.MustCompile(`(?i)(?:分步|逐步|一步一步|拆成多步).{0,12}(?:绕过|攻击|利用)`), label: "stepwise_attack_plan", weight: 2},
	{family: "staged_attack", pattern: regexp.MustCompile(`(?i)(?:先.+再|第一步.+第二步).{0,16}(?:规避|绕过|不被发现)`), label: "first_then_next_sequence", weight: 1, requiresCooccurrence: true},
	{family: "stealth_intent", pattern: regexp.MustCompile(`(?i)(?:静默|无声|悄悄).{0,8}(?:执行|运行|跑).{0,8}(?:不报警|不弹窗|不提醒|别触发告警)`), label: "silent_no_alert", weight: 2},
	{family: "stealth_intent", pattern: regexp.MustCompile(`(?i)(?:不留痕|避免日志|删掉记录)`), label: "avoid_trace", weight: 2},
}

var gatedAnchorFamilies = []string{
	"bypass_goal",
	"masquerade_method",
	"detector_target",
	"dangerous_outcome",
}

var detectorTargetSupportFamilies = []string{
	"bypass_goal",
	"masquerade_method",
	"approval_evasion",
	"dangerous_outcome",
}

var strongDetectorTargetHints = []string{
	"lynx插件",
	"风控",
	"审批",
	"检测器",
	"安全插件",
	"识别引擎",
}

func detectChineseEvasiveIntentGo(text string) signalDetection {
	normalizedText := normalizeDecisionText(text)
	if normalizedText == "" {
		return signalDetection{NormalizedText: normalizedText, Severity: "none"}
	}

	rawMatches := make([]riskSignal, 0)
	for _, literal := range chineseEvasiveIntentLiterals {
		if !containsAny(normalizedText, literal.term) {
			continue
		}
		rawMatches = append(rawMatches, riskSignal{
			Family:               literal.family,
			Token:                literal.term,
			Weight:               literal.weight,
			RequiresCooccurrence: literal.requiresCooccurrence,
			Reason:               "literal:" + literal.family + ":" + literal.term,
		})
	}
	for _, pattern := range chineseEvasiveIntentPatterns {
		if !pattern.pattern.MatchString(normalizedText) {
			continue
		}
		if pattern.family == "detector_target" && pattern.label == "explicit_guard_target" && !containsAny(normalizedText, strongDetectorTargetHints...) {
			continue
		}
		rawMatches = append(rawMatches, riskSignal{
			Family:               pattern.family,
			Token:                pattern.label,
			Weight:               pattern.weight,
			RequiresCooccurrence: pattern.requiresCooccurrence,
			Reason:               "pattern:" + pattern.family + ":" + pattern.label,
		})
	}

	ungatedFamilies := map[string]struct{}{}
	for _, match := range rawMatches {
		if !match.RequiresCooccurrence {
			ungatedFamilies[match.Family] = struct{}{}
		}
	}
	anchorUngatedFamilies := map[string]struct{}{}
	for family := range ungatedFamilies {
		if hasSignalFamily(gatedAnchorFamilies, family) {
			anchorUngatedFamilies[family] = struct{}{}
		}
	}

	filteredMatches := make([]riskSignal, 0, len(rawMatches))
	for _, match := range rawMatches {
		if !match.RequiresCooccurrence || hasDifferentFamily(anchorUngatedFamilies, match.Family) {
			filteredMatches = append(filteredMatches, match)
		}
	}

	filteredFamiliesSet := map[string]struct{}{}
	for _, match := range filteredMatches {
		filteredFamiliesSet[match.Family] = struct{}{}
	}
	if _, hasDetectorTarget := filteredFamiliesSet["detector_target"]; hasDetectorTarget && !hasAnyFamily(filteredFamiliesSet, detectorTargetSupportFamilies) {
		withoutDetectorTarget := make([]riskSignal, 0, len(filteredMatches))
		for _, match := range filteredMatches {
			if match.Family != "detector_target" {
				withoutDetectorTarget = append(withoutDetectorTarget, match)
			}
		}
		filteredMatches = withoutDetectorTarget
	}

	matchedFamilies := make([]string, 0, len(filteredMatches))
	matchedTerms := make([]string, 0, len(filteredMatches))
	reasons := make([]string, 0, len(filteredMatches))
	for _, match := range filteredMatches {
		matchedFamilies = append(matchedFamilies, match.Family)
		matchedTerms = append(matchedTerms, match.Token)
		reasons = append(reasons, match.Reason)
	}

	matchedFamilies = uniqueStrings(matchedFamilies)
	matchedTerms = uniqueStrings(matchedTerms)
	reasons = uniqueStrings(reasons)
	scoreDelta, reasons := resolveChineseEvasiveScoreDelta(matchedFamilies, len(filteredMatches) > 0, reasons)
	return signalDetection{
		Detected:        scoreDelta > 0,
		NormalizedText:  normalizedText,
		MatchedFamilies: matchedFamilies,
		MatchedTerms:    matchedTerms,
		Severity:        signalSeverity(scoreDelta),
		ScoreDelta:      scoreDelta,
		Reasons:         uniqueStrings(reasons),
	}
}

func resolveChineseEvasiveScoreDelta(families []string, hasAnyMatch bool, reasons []string) (float64, []string) {
	if !hasAnyMatch {
		return 0, reasons
	}
	switch {
	case hasSignalFamily(families, "bypass_goal") && hasSignalFamily(families, "masquerade_method") && hasSignalFamily(families, "dangerous_outcome"):
		return 4, append(reasons, "combo:high_bypass_masquerade_dangerous")
	case hasSignalFamily(families, "bypass_goal") && hasSignalFamily(families, "encoding_obfuscation") && hasSignalFamily(families, "detector_target"):
		return 3, append(reasons, "combo:high_bypass_encoding_detector")
	case hasSignalFamily(families, "bypass_goal") && hasSignalFamily(families, "wildcard_obfuscation") && hasSignalFamily(families, "detector_target"):
		return 3, append(reasons, "combo:high_bypass_wildcard_detector")
	case hasSignalFamily(families, "approval_evasion") && hasSignalFamily(families, "detector_target"):
		return 2, append(reasons, "combo:medium_approval_detector")
	case hasSignalFamily(families, "bypass_goal") && hasSignalFamily(families, "approval_evasion"):
		return 2, append(reasons, "combo:medium_bypass_approval")
	case hasSignalFamily(families, "bypass_goal") && hasSignalFamily(families, "detector_target"):
		return 2, append(reasons, "combo:medium_bypass_detector")
	case hasSignalFamily(families, "bypass_goal") && hasSignalFamily(families, "masquerade_method"):
		return 2, append(reasons, "combo:medium_bypass_masquerade")
	case len(families) >= 2 && hasAnySignalFamily(families, gatedAnchorFamilies):
		return 2, append(reasons, "combo:medium_multi_family_fallback")
	default:
		return 1, reasons
	}
}

func signalSeverity(scoreDelta float64) string {
	switch {
	case scoreDelta == 0:
		return "none"
	case scoreDelta == 1:
		return "low"
	case scoreDelta == 2:
		return "medium"
	default:
		return "high"
	}
}

func hasSignalFamily(families []string, family string) bool {
	for _, value := range families {
		if value == family {
			return true
		}
	}
	return false
}

func hasAnySignalFamily(families []string, candidates []string) bool {
	for _, candidate := range candidates {
		if hasSignalFamily(families, candidate) {
			return true
		}
	}
	return false
}

func hasDifferentFamily(families map[string]struct{}, family string) bool {
	for candidate := range families {
		if candidate != family {
			return true
		}
	}
	return false
}

func hasAnyFamily(families map[string]struct{}, candidates []string) bool {
	for _, candidate := range candidates {
		if _, ok := families[candidate]; ok {
			return true
		}
	}
	return false
}
