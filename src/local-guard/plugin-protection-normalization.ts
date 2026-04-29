interface PluginProtectionNormalizationRule {
  from: RegExp;
  to: string;
}

const PLUGIN_PROTECTION_NORMALIZATIONS: PluginProtectionNormalizationRule[] = [
  { from: /\bshan\s*-?\s*chu\b/gi, to: "删除" },
  { from: /\bqu\s*-?\s*diao\b/gi, to: "删除" },
  { from: /删掉|删了|删一下|去掉|去除|去除掉|干掉|弄掉|拿掉|撤掉|摘掉|拔掉|搞掉|弄没|废掉/g, to: "删除" },
  { from: /\byi\s*-?\s*chu\b/gi, to: "移除" },
  { from: /\bqing\s*-?\s*chu\b/gi, to: "清除" },
  { from: /清掉|抹掉/g, to: "清除" },
  { from: /\bxiu\s*-?\s*gai\b/gi, to: "修改" },
  { from: /\bgeng\s*-?\s*gai\b/gi, to: "更改" },
  { from: /\bgai\s*-?\s*diao\b/gi, to: "修改" },
  { from: /改掉|改动/g, to: "修改" },
  { from: /改写掉/g, to: "重写" },
  { from: /替换掉|换掉|替掉/g, to: "修改" },
  { from: /改写|覆写/g, to: "重写" },
  { from: /替换|篡改|动手脚|做手脚|魔改/g, to: "修改" },
  { from: /\bjin\s*-?\s*yong\b/gi, to: "禁用" },
  { from: /\bting\s*-?\s*yong\b/gi, to: "停用" },
  { from: /\bguan\s*-?\s*bi\b/gi, to: "关闭" },
  { from: /\bguan\s*-?\s*diao\b/gi, to: "关闭" },
  { from: /\bxie\s*-?\s*zai\b/gi, to: "卸载" },
  { from: /关了|停了|停掉|关停|屏蔽|封掉|失效|作废|下线/g, to: "停用" },
  { from: /\bgai\s*-?\s*ming\b/gi, to: "改名" },
  { from: /\bchong\s*-?\s*ming\s*-?\s*ming\b/gi, to: "重命名" },
  { from: /\byi\s*-?\s*dong\b/gi, to: "移动" },
  { from: /\bnuo\s*-?\s*zou\b/gi, to: "移动" },
  { from: /搬走|挪开|挪地方|迁走|转走|转移/g, to: "移动" },
];

export function normalizePluginProtectionText(text: string): string {
  if (!text) return "";

  let normalized = text;
  for (const rule of PLUGIN_PROTECTION_NORMALIZATIONS) {
    normalized = normalized.replace(rule.from, rule.to);
  }

  normalized = normalized.replace(/[\u200B-\u200D\uFEFF]/g, "");
  normalized = normalized.replace(/\s+/g, " ").trim();

  return normalized;
}
