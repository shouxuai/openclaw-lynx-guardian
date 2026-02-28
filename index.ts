import { resolve, normalize } from "path";
import type { OpenClawPluginApi } from "./src/types.js";
import { ensureUserRegistered, readRecentContext } from "./src/utils.js";
import { registerUser, checkContent, checkTool, pushRecord } from "./src/api.js";
import { checkExecBlacklist, checkPathBlacklist } from "./src/blacklist.js";

function canonicalizePath(raw: string): string {
  if (typeof raw !== "string" || raw.length === 0) {
    return "";
  }
  if (raw.startsWith("~/")) raw = raw.replace("~", process.env.HOME ?? "/root");
  return normalize(resolve(raw));
}

export default function setup(api: OpenClawPluginApi) {
  const log = api.logger;
  log.info("[lynx-guardian] Plugin loading...");

  // 1. User Registration
  let userId: string;
  try {
    userId = ensureUserRegistered();
    registerUser(userId).then(res => {
      log.info(`[lynx-guardian] Registered user: ${userId}, status: ${res.code}`);
    }).catch(err => {
      log.error(`[lynx-guardian] Registration failed: ${err.message}`);
    });
  } catch (err: any) {
    log.error(`[lynx-guardian] Failed to initialize user ID: ${err.message}`);
    return;
  }

  // 2. Agent Input Detection (before_agent_start)
  api.on("before_agent_start", async (event, ctx) => {
    try {
      if (!event.prompt || !event.messages) return;
      const input = typeof event.prompt === 'string' ? event.prompt.replace(/^\[[^\]]+\]\s*/, "") : JSON.stringify(event.prompt);
      
      const res = await checkContent(userId, input, 1);
      
      if (res.result.risk_level > 0) {
        let warning = `⚠️重要提醒：内容包含内容风险（${res.result.level_one}、${res.result.level_two}、${res.result.level_three}），`;
        if (warning.includes("个人隐私")) {
          warning += "包含隐私内容需要进行脱敏处理。\n";
        } else if (!res.result.level_one.includes("其他")) {
          warning += "包含价值观不正当，进行价值观正向引导。\n";
        } else {
          warning += "插件已进行拦截。\n";
        }
        log.warn(`[lynx-guardian] Input risk detected: ${warning}`);
        return {
          prependContext: warning
        } as any
      }
      return;
    } catch (err: any) {
      log.error(`[lynx-guardian] Input check failed: ${err.message}`);
    }
  });

  // 3. Agent Output Detection (agent_end)
  api.on("agent_end", async (event, ctx) => {
    try {
      log.info(JSON.stringify(ctx));
      if (!event.messages) return;
      const lastContent = event.messages[event.messages.length - 1].content;
      const lastMessage = lastContent[lastContent.length -1];
      const output = lastMessage?.text ?? "";
      const res = await checkContent(userId, output, 2);

      if (res.result.risk_level > 0) {
        
        let warning = `⚠️重要提醒：内容包含内容风险（${res.result.level_one}、${res.result.level_two}、${res.result.level_three}）`;
        if (warning.includes("个人隐私")) {
          warning += "隐私内容需要进行脱敏处理，请勿在非必要场景随意提供。";
        } else {
          warning += "lynx-guardian 插件已进行拦截。";
        }

        log.warn(`[lynx-guardian] Output risk detected: ${warning}`);
      }
    } catch (err: any) {
      log.error(`[lynx-guardian] Output check failed: ${err.message}`);
    }
  });

  // 4. Tool Call Detection (before_tool_call)
  api.on("before_tool_call", async (event, ctx) => {
    const { toolName, params } = event;
    
    // Local Blacklist Check
    let match = null;
    log.info(params?.command)
    if (toolName === "exec") {
      match = checkExecBlacklist((params?.command ?? "") as string);
    } else if (toolName === "write" || toolName === "edit") {
      const rawPath = (params?.file_path ?? params?.path ?? "") as string;
      log.info(`[lynx-guardian] Raw path: ${rawPath}`);
      const safePath = canonicalizePath(rawPath);
      match = checkPathBlacklist(safePath);
    }
    log.info(`[lynx-guardian] Tool call: ${toolName} | ${JSON.stringify(params)}`);
    log.info(JSON.stringify(match));  
    if (!match) return; // Safe

    log.warn(`[lynx-guardian] Blacklist hit: ${toolName} | ${match.reason}`);

    const detail = toolName === "exec" ? (params?.command ?? "") : (params?.file_path ?? params?.path ?? "");
    const contentToReport = toolName === "exec" ? `执行 ${detail} 命令` : `${toolName} ${detail}`;

    // Report to backend
    try {
      const riskLevel = match.level === "critical" ? 3 : 2;
      await pushRecord(userId, contentToReport, riskLevel);
    } catch (err: any) {
      log.error(`[lynx-guardian] Failed to push blacklist record: ${err.message}`);
    }

    // Call Tool Check API
    try {
      // Construct content: "Is it okay to ...? User: ..."
      const userContext = readRecentContext(ctx.sessionKey);
      log.info(`[lynx-guardian] User context: ${userContext}`);
      const content = `是否${match.reason} ${detail}？用户：${userContext}`;

      const res = await checkTool(userId, content);
      const riskLevel = res.result.risk_level;

      log.info(`[lynx-guardian] Tool check result: risk=${riskLevel}`);

      // Risk Assessment & Intervention
      if (riskLevel >= 3) {
        // High Risk -> Intercept
        return {
          block: true,
          blockReason: `[Lynx Guardian] 高危操作被拦截 (Risk Level ${riskLevel}): ${match.reason}`
        };
      } else if (riskLevel === 2) {
        // Medium Risk -> User Confirmation
        return {
          block: true,
          blockReason: `[Lynx Guardian] 中危操作需确认: ${match.reason}. 请明确回复"确认"或"同意"后重试。`
        };
      } else if (riskLevel === 1) {
        // Low Risk -> Safety Advice
        log.info(`[lynx-guardian] 识别到内容风险: ${res.result.content}`);
        return; 
      } else {
        // No Risk -> Pass
        return;
      }

    } catch (err: any) {
      log.error(`[lynx-guardian] Tool check failed: ${err.message}`);
      // Fail safe: Block if check fails
      return {
        block: true,
        blockReason: `[Lynx Guardian] 安全检测失败: ${err.message}`
      };
    }
  });
}
