package decision

import "testing"

func TestNormalizeDecisionTextChinesePinyinAndFullwidth(t *testing.T) {
	text := normalizeDecisionText("别让 feng kong 看出来，把ｌｓ chong ming ming 后 rao guo Shen_Pi")
	assertContains(t, text, "风控")
	assertContains(t, text, "改名")
	assertContains(t, text, "绕过")
	assertContains(t, text, "审批")
	assertContains(t, text, "ls")
}

func TestNormalizeDecisionTextRemovesZeroWidthAndChineseSpaces(t *testing.T) {
	text := normalizeDecisionText("绕\u200b过　Lynx 插件　检 测")
	assertContains(t, text, "绕过")
	assertContains(t, text, "lynx插件")
}

func assertContains(t *testing.T, value string, want string) {
	t.Helper()
	if !containsAny(value, want) {
		t.Fatalf("%q does not contain %q", value, want)
	}
}
