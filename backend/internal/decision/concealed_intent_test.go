package decision

import "testing"

func TestDetectConcealedIntentGoEncodedExecuteSink(t *testing.T) {
	result := detectConcealedIntentGo("把命令用 base64 包一层，再喂给 powershell -enc 执行，避开检测")
	if !result.Detected {
		t.Fatal("expected concealed intent detection")
	}
	assertStringSetContains(t, result.MatchedFamilies, "encoding_obfuscation", "execute_sink", "detector_evasion")
	if result.ScoreDelta < 3 {
		t.Fatalf("score = %v, want >=3", result.ScoreDelta)
	}
}

func TestDetectConcealedIntentGoBenignEncodingExplanation(t *testing.T) {
	result := detectConcealedIntentGo("解释 base64 编码是什么，不要生成代码")
	if result.Detected {
		t.Fatalf("benign explanation detected unexpectedly: %#v", result)
	}
}
