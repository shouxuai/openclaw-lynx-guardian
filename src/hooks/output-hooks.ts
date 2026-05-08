import type { OpenClawPluginApi } from "../types.js";
import type { LynxReportDeliveryAttempt } from "../types.js";
import type {
  RecentActiveDeliverySnapshot,
  RecentActiveDeliveryTarget,
} from "../delivery/recent-delivery.js";
import type { LynxHookRuntimeContext } from "./setup.js";
import * as messageDelivery from "../delivery/message-delivery.js";
import * as safetyGuard from "../guard/safety-guard.js";
import { stripToolUseAssistantPreamble } from "../runtime/tool-use-assistant-persistence.js";

export function registerOutputHooks(api: OpenClawPluginApi, runtime: LynxHookRuntimeContext): void {
  const {
    join,
    writeFileSync,
    readFileSync,
    unlinkSync,
    existsSync,
    ensureUserRegistered,
    readRecentContext,
    ensureResources,
    baseIpInfo,
    extractContentAfterDate,
    checkExecBlacklist,
    checkPathBlacklist,
    SensitiveDataBlocker,
    guardInput,
    guardOutput,
    guardToolCall,
    enforceGuardDecisionText,
    guardAssistantPersistence,
    guardOutputText,
    guardToolResultPersistence,
    buildSecurityAwarenessInjection,
    resolveRiskPolicy,
    runSecurityAudit,
    runMaliciousScriptScan,
    formatAuditSummary,
    getPendingOverride,
    grantManagedLynxCheckAuthorization,
    hasManagedLynxCheckAuthorization,
    claimRequesterProvenance,
    readRequesterProvenance,
    rememberRequesterProvenance,
    readRunApprovalContext,
    saveRunApprovalContext,
    consumeFeishuLocalApprovalGrant,
    consumeFeishuLocalApprovalReplay,
    discardLocalToolApproval,
    getOrCreatePendingToolApproval,
    listLocalToolApprovalsForSession,
    matchApprovalGrant,
    matchFeishuRunContinuation,
    persistGrantFromApproval,
    readLocalToolApprovalByToken,
    registerLocalToolApproval,
    resolvePluginApprovalCompat,
    saveFeishuLocalApprovalGrant,
    saveFeishuLocalApprovalReplay,
    saveFeishuRunContinuation,
    revokeApprovalGrantsForLifecycle,
    buildToolApprovalRequest,
    toApprovalRiskLevel,
    buildApprovalRequestFingerprint,
    deliverLynxFeishuApprovalPromptDirectly,
    assessSkillRisk,
    configureSkillInventoryControlPlane,
    detectSkillInstall,
    quickBlacklistCheck,
    verifyAllInstalledSkills,
    quarantineSkill,
    DISCOVERY_CONFIG_SOURCE_PATH,
    loadDiscoveryRuntimeConfig,
    recommendContext,
    routeModel,
    checkBudget,
    planHeartbeat,
    formatContextRecommendation,
    formatModelRouting,
    formatBudgetStatus,
    buildOptimizationHints,
    isTokenOptimizerAvailable,
    reconcileScheduledLynxCheck,
    resolveScheduledLynxCheckConfig,
    canonicalizePath,
    buildGuardContext,
    createReplacementMessage,
    extractMessageText,
    normalizeString,
    redactAgentOutput,
    buildOperationFingerprint,
    consumeApprovedOverrideFull,
    inferBlacklistModules,
    resolveOverrideKey,
    resolveOverrideKeys,
    savePendingOverrideFull,
    buildGuardPolicyTrace,
    buildApiRiskAssessment,
    buildPolicyRecordContent,
    buildOverridePrompt,
    buildParamSummary,
    evaluateGuardDecisionPolicy,
    evaluateRiskAssessment,
    normalizePolicyConfig,
    LOCAL_TOOL_APPROVAL_COMMAND,
    buildForcedAgentStartDenyContext,
    buildToolApprovalRoute,
    mergeApprovalContextSeed,
    normalizeFeishuConversationId,
    normalizeOuIdList,
    parseLocalToolApprovalReply,
    recoverFeishuDmApprovalContextFromRecentRoute,
    rememberInboundRequesterProvenance,
    resolveActorOuId,
    resolveAgentStartPromptText,
    resolveChannelApprovalTransport,
    resolveChannelProfile,
    resolveGuardPolicyState,
    resolveManagedLynxCheckCommandText,
    isManualCompositeLynxCheckRequest,
    classifyLynxCheckTrigger,
    clearPendingDiscoveryRequest,
    ensureParentDirectory,
    shouldAttachPendingDiscoveryReport,
    formatDiscoveryReport,
    decorateAssistantMessage,
    buildManualLynxCheckReport,
    clearRecentActiveDeliveryTargetForContext,
    hasConcreteDeliveryTarget,
    getRecentActiveDeliveryTargets,
    readRecentActiveDeliverySnapshots,
    readRecentActiveDeliverySnapshot,
    getRecentActiveDeliveryTarget,
    rememberRecentActiveDeliveryTarget,
    shouldPreferRecentActiveDelivery,
    getHookCapabilityReport,
    getOpenClawRuntimeVersion,
    deliverLynxReport,
    shapeMessageForProvider,
    shapeTextForProvider,
    configureLynxCheckTaskControlPlane,
    createLynxCheckRunIntent,
    getLynxCheckRunReportPath,
    markLynxCheckRunCompleted,
    readLatestPendingLynxCheckRunIntent,
    readLynxCheckRunResult,
    updateLynxCheckRunIntentStatus,
    waitForLynxCheckRunResultSettled,
    writeLynxCheckRunResult,
    buildLynxCheckFallbackFailureNotice,
    buildManualLynxCheckPrompt,
    buildScheduledLynxCheckPrompt,
    deliverManagedLynxAuditReport,
    createLocalConsoleTokenProvider,
    ensureLocalConsoleToken,
    createLocalConsoleIngestClient,
    resolveLocalConsoleRuntimeConfig,
    DecisionBroker,
    GoControlPlaneClient,
    handleBeforeAgentStartDecision,
    handleBeforeDispatchDecision,
    handleBeforeInstallEventDecision,
    handleBeforeMessageWriteDecision,
    handleBeforeToolCallDecision,
    handleLlmOutputDecision,
    handleMessageReceivedDecision,
    handleMessageSendingDecision,
    handleToolResultPersistDecision,
    createLocalConsoleGatewayRouteRegistrations,
    createLocalConsoleHookHandlers,
    buildLocalConsoleLynxCheckSnapshot,
    createLocalConsoleSupervisor,
    createLocalConsoleTokenHook,
    appendLocalConsoleWebviewFootnote,
    appendLocalConsoleWebviewFootnoteForL4Reply,
    isTrustedManagedLynxCheckReportText,
    guardInboundMessageBeforeWrite,
    guardPromptBuildInput,
    buildVisibleInputGuardModelContext,
    buildVisibleInputGuardWarning,
    resolvePluginRuntimeConfig,
    buildDeliveryTargetSnapshot,
    buildFeishuNativeToolApprovalReplyPrompt,
    buildOutboundDeliveryTarget,
    createPluginSetupHelpers,
    resolveManagedLynxCheckPromptChannel,
    resolveManagedLynxCheckSource,
    resolveToolApprovalProtectedTargetSummary,
    log,
    sensitiveDataBlocker,
    config,
    localConsoleRuntimeConfig,
    localConsoleRuntime,
    localConsoleHooks,
    decisionBroker,
    selfSafetyGuardConfig,
    outputEnforcementMode,
    riskPolicyConfig,
    trustedOwnerOuIds,
    localApprovalApproverOuIds,
    securityAuditConfig,
    skillGuardConfig,
    tokenOptimizerConfig,
    scheduledLynxCheckConfig,
    managedLynxCheckAuthorizationConfig,
    resolvedScheduledLynxCheckConfig,
    discoveryRuntime,
    openClawDiscoveryConfig,
    runtimeVersion,
    hookCapabilityReport,
    localConsoleTokenHook,
    appendLogWebviewNoteForL4,
    appendLogWebviewNoteForL3Approval,
    DISCOVERY_RESULT_PATH,
    DISCOVERY_RESULT_CONSUMED_PATH,
    DISCOVERY_REQUEST_PATH,
    HOOK_PROBE_LOG_PATH,
    userId,
    appendLifecycleProbe,
    buildFeishuApprovedReplayContext,
    buildManagedGuardContext,
    buildScheduledLynxCheckSyncConfig,
    handleFeishuLocalToolApproval,
    isManagedLynxCheckPreauthorized,
    isScheduledManagedLynxCheckCronContext,
    prepareToolApprovalHandlers,
    resolveFeishuLocalToolApprovalReply,
    resolveManagedLynxCheckRouteHint,
    resolveOutboundPromptChannel,
    sendAssistantMessageWithRetry,
    sendFeishuNativeToolApprovalPrompt,
    sendHookFeedback,
    tryResolveFeishuLocalToolApprovalReply,
    logGuardPolicyTrace,
  } = runtime;
  const liveDeliverLynxReport = (...args: Parameters<typeof messageDelivery.deliverLynxReport>) =>
    messageDelivery.deliverLynxReport(...args);
  const liveGuardOutput = (...args: Parameters<typeof safetyGuard.guardOutput>) =>
    safetyGuard.guardOutput(...args);
  api.on("agent_end", async (event, ctx) => {
    try {
      log.info(JSON.stringify(ctx));
      const revokedGrants = revokeApprovalGrantsForLifecycle?.({
        sessionKey: normalizeString(ctx?.sessionKey) || undefined,
        chainId: normalizeString((event as any)?.chainId ?? (ctx as any)?.chainId) || undefined,
        runId: normalizeString((event as any)?.runId ?? (ctx as any)?.runId) || undefined,
        reason: "agent_end",
      }) ?? 0;
      if (revokedGrants > 0) {
        log.info(`[lynx-guardian] Revoked ${revokedGrants} in-memory approval grant(s) on agent_end`);
      }

      if (!event.messages || event.messages.length === 0) return;
      const localConsoleOccurredAtMs = Date.now();

      const activeRunIntent = readLatestPendingLynxCheckRunIntent(ctx.sessionKey);
      if (activeRunIntent) {
        let runResult = readLynxCheckRunResult(activeRunIntent.requestId);
        if (!runResult || runResult.status === "not_started" || runResult.status === "running") {
          runResult = await waitForLynxCheckRunResultSettled(activeRunIntent.requestId, {
            maxWaitMs: 250,
            pollIntervalMs: 25,
          });
        }
        const routeHint = activeRunIntent.routeHint ?? null;
        const reportPath = runResult?.reportPath ?? getLynxCheckRunReportPath(activeRunIntent.requestId);
        let inlineOutput = extractMessageText(event.messages[event.messages.length - 1]);
        const currentDeliveryTarget = buildDeliveryTargetSnapshot(ctx);
        const inlineManagedReportDelivered = isTrustedManagedLynxCheckReportText(inlineOutput);
        const inlineDeliveryEligible = activeRunIntent.source !== "scheduled"
          || hasConcreteDeliveryTarget(currentDeliveryTarget);

        if (inlineManagedReportDelivered) {
          const inlineOutputWithLogNote = appendLocalConsoleWebviewFootnote(inlineOutput);
          if (inlineOutputWithLogNote !== inlineOutput) {
            redactAgentOutput(event, inlineOutputWithLogNote);
            inlineOutput = inlineOutputWithLogNote;
          }
          const inlineAttempt: LynxReportDeliveryAttempt = {
            targetKey: normalizeString(ctx.sessionKey) || "inline-message",
            sessionKey: normalizeString(ctx.sessionKey) || undefined,
            channelId: currentDeliveryTarget.channelId,
            messageProvider: currentDeliveryTarget.messageProvider,
            senderId: currentDeliveryTarget.senderId,
            delivered: true,
            transport: "inline-message",
          };
          let complementaryFanoutResult = {
            delivered: false,
            transport: "none",
            deliveryAttempts: [] as LynxReportDeliveryAttempt[],
          };

          if (activeRunIntent.source === "scheduled") {
          complementaryFanoutResult = await deliverManagedLynxAuditReport({
            log,
            ctx,
            tag: `lynx-check-inline-fanout-${activeRunIntent.requestId}`,
            attempts: 1,
            routeHint,
            allowSameSessionFallback: false,
            excludeMessageProviders: inlineDeliveryEligible && currentDeliveryTarget.messageProvider
              ? [currentDeliveryTarget.messageProvider]
              : [],
            excludeChannelIds: inlineDeliveryEligible && currentDeliveryTarget.channelId
              ? [currentDeliveryTarget.channelId]
              : [],
            useSessionStoreFallback: true,
            message: {
              role: "assistant",
              content: inlineOutput,
            },
          });
          }

          if (activeRunIntent.source === "scheduled" && !inlineDeliveryEligible) {
            log.warn(
              `[lynx-guardian] Scheduled /lynx-check inline report had no concrete current delivery target requestId=${activeRunIntent.requestId}`,
            );
          }

          const deliveryAttempts = [
            ...(inlineDeliveryEligible ? [inlineAttempt] : []),
            ...complementaryFanoutResult.deliveryAttempts,
          ];
          const deliveredAttempts = deliveryAttempts.filter((attempt) => attempt.delivered);
          const deliveredTransports = [...new Set(
            deliveredAttempts.map((attempt) => attempt.transport),
          )];

          const completedRunResult = writeLynxCheckRunResult(activeRunIntent.requestId, {
            status: "completed",
            sendAttempted: true,
            sendSucceeded: deliveredAttempts.length > 0,
            transport: deliveredTransports.join(",") || "none",
            deliveryAttempts,
            reportPath: existsSync(reportPath) ? reportPath : undefined,
          });
          markLynxCheckRunCompleted(activeRunIntent.requestId);
          localConsoleHooks?.agentEnd({
            occurredAtMs: localConsoleOccurredAtMs,
            sessionKey: normalizeString(ctx.sessionKey) || undefined,
            runId: normalizeString((ctx as any).runId) || undefined,
            requestId: activeRunIntent.requestId,
            summary: "Managed /lynx-check inline report delivery completed during agent_end.",
            outputText: inlineOutput,
            contentExcerpt: inlineOutput,
            contentKind: "assistant_message",
            enforcementAction: "allow",
            lynxCheck: buildLocalConsoleLynxCheckSnapshot(activeRunIntent, completedRunResult),
            payloadJson: {
              deliveryAttempts: deliveryAttempts.length,
              deliveredTransports,
            },
          });
          return;
        }

        let finalRunResult = runResult;
        if (runResult?.status === "completed" && runResult.sendSucceeded) {
          markLynxCheckRunCompleted(activeRunIntent.requestId);
        } else {
          const fallbackContent = existsSync(reportPath)
            ? readFileSync(reportPath, "utf8")
            : buildLynxCheckFallbackFailureNotice(activeRunIntent.requestId);
          const sendResult = await sendAssistantMessageWithRetry({
            ctx,
            tag: `lynx-check-run-${activeRunIntent.requestId}`,
            attempts: 3,
            routeHint,
            allowSameSessionFallback: activeRunIntent.preferredTargetKind === "current",
            useSessionStoreFallback: activeRunIntent.source === "scheduled",
            message: {
              role: "assistant",
              content: fallbackContent,
            },
          });

          const fallbackRunResult = writeLynxCheckRunResult(activeRunIntent.requestId, {
            status: sendResult.delivered ? "completed" : "failed",
            sendAttempted: true,
            sendSucceeded: sendResult.delivered,
            transport: sendResult.transport,
            deliveryAttempts: sendResult.deliveryAttempts,
            reportPath: existsSync(reportPath) ? reportPath : undefined,
            errorMessage: sendResult.delivered
              ? undefined
              : `Fallback delivery failed (transport=${sendResult.transport})`,
          });
          finalRunResult = fallbackRunResult;

          if (sendResult.delivered) {
            markLynxCheckRunCompleted(activeRunIntent.requestId);
          } else {
            updateLynxCheckRunIntentStatus(activeRunIntent.requestId, "failed");
          }
        }

        localConsoleHooks?.agentEnd({
          occurredAtMs: localConsoleOccurredAtMs,
          sessionKey: normalizeString(ctx.sessionKey) || undefined,
          runId: normalizeString((ctx as any).runId) || undefined,
          requestId: activeRunIntent.requestId,
          summary: runResult?.status === "completed" && runResult.sendSucceeded
            ? "Managed /lynx-check run was already completed before agent_end delivery fallback."
            : "Managed /lynx-check delivery fallback was processed during agent_end.",
          outputText: inlineOutput,
          contentExcerpt: inlineOutput,
          contentKind: "assistant_message",
          enforcementAction: (finalRunResult?.status === "failed" || finalRunResult?.sendSucceeded === false) ? "warn" : "allow",
          lynxCheck: finalRunResult
            ? buildLocalConsoleLynxCheckSnapshot(activeRunIntent, finalRunResult)
            : undefined,
          payloadJson: {
            requestId: activeRunIntent.requestId,
            runResultStatus: finalRunResult?.status,
            sendSucceeded: finalRunResult?.sendSucceeded,
            transport: finalRunResult?.transport,
          },
        });
        return;
      }

      const isDiscoveryResponse = existsSync(DISCOVERY_RESULT_PATH) || existsSync(DISCOVERY_RESULT_CONSUMED_PATH);
      const shouldAttachDiscoveryReport = shouldAttachPendingDiscoveryReport(DISCOVERY_REQUEST_PATH, ctx.sessionKey)
        || normalizeString((ctx as any)?.subsystem).toLowerCase() === "plugins";

      let recentTarget: RecentActiveDeliveryTarget | null = null;
      let recentRouteHint: RecentActiveDeliverySnapshot | null = null;
      const allowSameSessionFallback = normalizeString((ctx as any)?.subsystem).toLowerCase() !== "plugins";
      if (
        existsSync(DISCOVERY_RESULT_PATH)
        && shouldAttachDiscoveryReport
        && shouldPreferRecentActiveDelivery(ctx, resolvedScheduledLynxCheckConfig.deliveryMode)
      ) {
        recentTarget = getRecentActiveDeliveryTarget();
        recentRouteHint = recentTarget ?? readRecentActiveDeliverySnapshot();
        if (recentRouteHint) {
          log.info(
            `[lynx-guardian] Discovery result will reuse recent active session (${recentRouteHint.messageProvider ?? recentRouteHint.channelId ?? recentRouteHint.sessionKey ?? recentRouteHint.targetKey})`,
          );
        } else {
          log.warn("[lynx-guardian] No recent active delivery target available for scheduled /lynx-check");
        }
      }

      if (
        existsSync(DISCOVERY_RESULT_PATH)
        && shouldAttachDiscoveryReport
      ) {
        try {
          const discoveryOutput = readFileSync(DISCOVERY_RESULT_PATH, "utf8");
          if (discoveryOutput) {
            const sendResult = await liveDeliverLynxReport({
              log,
              ctx,
              tag: "agent-end-/lynx-check-report",
              attempts: 3,
              routeHint: recentRouteHint,
              routeHintSendMessage: recentTarget?.sendMessage,
              allowSameSessionFallback,
              useSessionStoreFallback: shouldPreferRecentActiveDelivery(ctx, resolvedScheduledLynxCheckConfig.deliveryMode),
              message: {
                role: "assistant",
                content: formatDiscoveryReport(discoveryOutput),
              },
            });
            if (sendResult.delivered) {
              unlinkSync(DISCOVERY_RESULT_PATH);
              clearPendingDiscoveryRequest(DISCOVERY_REQUEST_PATH);
              log.info(`[lynx-guardian] Discovery report sent through agent_end active delivery (transport=${sendResult.transport})`);
            }
          }
        } catch (sendErr: any) {
          log.error(`[lynx-guardian] Discovery sendMessage 失败: ${sendErr.message}`);
        }
      }
      
      if (existsSync(DISCOVERY_RESULT_CONSUMED_PATH)) {
        try {
          unlinkSync(DISCOVERY_RESULT_CONSUMED_PATH);
        } catch (cleanupErr: any) {
          log.error(`[lynx-guardian] Discovery consumed 标记清理失败: ${cleanupErr.message}`);
        }
      }

      const lastMsg = event.messages[event.messages.length - 1];
      if (!lastMsg?.content) return;
      const lastContent = Array.isArray(lastMsg.content) ? lastMsg.content : [{ text: typeof lastMsg.content === "string" ? lastMsg.content : "" }];
      if (lastContent.length === 0) return;
      const lastMessage = lastContent[lastContent.length - 1];
      let output = lastMessage?.text ?? "";
      const outputWithL4LogNote = appendLocalConsoleWebviewFootnoteForL4Reply(output);
      if (outputWithL4LogNote !== output.trimEnd()) {
        redactAgentOutput(event, outputWithL4LogNote);
        output = outputWithL4LogNote;
      }
      if (selfSafetyGuardConfig.outputGuard !== false && output && !isDiscoveryResponse) {
        const { guardContext } = buildManagedGuardContext({ output, messages: event.messages }, ctx);
        const decision = liveGuardOutput(output, ctx.sessionKey, guardContext);
        const { guardActionRequired, policyEvaluation, policyResolution, effectiveAssessment } = resolveGuardPolicyState(decision);
        log.info(`[lynx-guardian] Output risk detected: ${JSON.stringify(decision)}`);
        logGuardPolicyTrace(log, "agent_end_output", decision, policyResolution);
        if (guardActionRequired) {
          const enforcement = enforceGuardDecisionText(
            output,
            {
              block: true,
              warning: decision.warning,
              riskAssessment: effectiveAssessment,
            },
            {
              ...guardContext,
              enforcementMode: outputEnforcementMode,
            },
            {
              subject: "assistant output",
            },
          );
          if (enforcement.warning) {
            log.warn(`[lynx-guardian] Output guard diagnostic: ${enforcement.warning}`);
          }
          if (enforcement.changed) {
            redactAgentOutput(event, enforcement.content);
          }
          localConsoleHooks?.agentEnd({
            occurredAtMs: localConsoleOccurredAtMs,
            sessionKey: normalizeString(ctx.sessionKey) || undefined,
            runId: normalizeString((ctx as any).runId) || undefined,
            summary: decision.warning ?? "Assistant output was changed during agent_end enforcement.",
            outputText: enforcement.content,
            contentExcerpt: enforcement.content,
            contentKind: "assistant_message",
            primaryModule: effectiveAssessment.modules[0],
            modules: effectiveAssessment.modules,
            riskLevel: effectiveAssessment.level,
            riskScore: effectiveAssessment.score,
            enforcementAction: enforcement.changed ? "redact" : "block",
          });
          return;
            log.warn(`[lynx-guardian] Self-safety-guard blocked output: ${decision.riskAssessment.description}`);
          redactAgentOutput(event, "[Lynx Guardian] 输出已被安全防护替换：检测到受保护配置泄露风险");
        }
        if (decision.warning) {
          log.warn(`[lynx-guardian] Self-safety-guard output warning: ${decision.warning}`);
        }
      }

      localConsoleHooks?.agentEnd({
        occurredAtMs: localConsoleOccurredAtMs,
        sessionKey: normalizeString(ctx.sessionKey) || undefined,
        runId: normalizeString((ctx as any).runId) || undefined,
        summary: "Agent end completed and assistant output remained available for downstream handling.",
        outputText: output,
        contentExcerpt: output,
        contentKind: "assistant_message",
        enforcementAction: "allow",
      });
    } catch (err: any) {
      log.error(`[lynx-guardian] Output check failed: ${err.message}`);
    }
  });

  if (localConsoleTokenHook) {
    api.on("llm_output", async (event, ctx) => {
      appendLifecycleProbe("llm_output", event, ctx);
      if (decisionBroker) {
        handleLlmOutputDecision(decisionBroker, event, ctx);
      }
      localConsoleTokenHook.handle(event, ctx);
    });
  }

  api.on("before_message_write", (event, ctx) => {
    try {
      if (decisionBroker) {
        handleBeforeMessageWriteDecision(decisionBroker, event, ctx);
      }
      const localConsoleOccurredAtMs = Date.now();
      const localConsoleRunId = normalizeString((ctx as any).runId) || undefined;
      const originalMessage = event?.message;
      if (!originalMessage) return;

      if (selfSafetyGuardConfig.inputGuard !== false && originalMessage.role !== "assistant") {
        const inputWriteGuard = guardInboundMessageBeforeWrite(originalMessage, {
          sessionKey: normalizeString(ctx.sessionKey) || undefined,
          guardContext: buildGuardContext(config, event, ctx) as any,
        });
        if (inputWriteGuard.blocked) {
          localConsoleHooks?.beforeMessageWrite({
            occurredAtMs: localConsoleOccurredAtMs,
            sessionKey: normalizeString(ctx.sessionKey) || undefined,
            runId: localConsoleRunId,
            summary: inputWriteGuard.reason ?? "Inbound message risk detected before persistence.",
            contentExcerpt: extractMessageText(originalMessage),
            contentKind: "user_message",
            messageRole: originalMessage.role,
            blocked: true,
            enforcementAction: "block",
            payloadJson: {
              fallbackInputGuard: true,
              inputPreserved: true,
              modules: inputWriteGuard.decision?.riskAssessment.modules,
            },
          });
        }
        return;
      }

      let nextMessage = stripToolUseAssistantPreamble(originalMessage);
      nextMessage = decorateAssistantMessage(nextMessage);
      if (nextMessage.role === "assistant") {
        const currentText = extractMessageText(nextMessage);
        const nextText = appendLocalConsoleWebviewFootnoteForL4Reply(currentText);
        if (nextText !== currentText.trimEnd()) {
          nextMessage = createReplacementMessage(nextMessage, nextText);
        }
      }
      if (nextMessage.role === "assistant" && isTrustedManagedLynxCheckReportText(nextMessage)) {
        const currentText = extractMessageText(nextMessage);
        const nextText = appendLocalConsoleWebviewFootnote(currentText);
        if (nextText !== currentText) {
          nextMessage = createReplacementMessage(nextMessage, nextText);
        }
      }
      if (nextMessage.role === "assistant" && resolveManagedLynxCheckPromptChannel(ctx) === "feishu") {
        const { guardContext } = buildManagedGuardContext({ message: nextMessage }, ctx);
        if (guardContext.trustedManagedLynxCheckPersistence === true) {
          const shapedMessage = shapeMessageForProvider(nextMessage, "feishu");
          if (shapedMessage !== nextMessage) {
            log.info("[lynx-guardian] Managed /lynx-check assistant message shaped for Feishu before persistence");
            nextMessage = shapedMessage;
          }
        }
      }
      if (nextMessage.role === "assistant" && isTrustedManagedLynxCheckReportText(nextMessage)) {
        const currentText = extractMessageText(nextMessage);
        const nextText = appendLocalConsoleWebviewFootnote(currentText);
        if (nextText !== currentText) {
          nextMessage = createReplacementMessage(nextMessage, nextText);
        }
      }

      if (selfSafetyGuardConfig.outputGuard !== false && nextMessage.role === "assistant") {
        const { guardContext } = buildManagedGuardContext({ message: nextMessage }, ctx);
        const persistenceDecision = guardAssistantPersistence(nextMessage, {
          ...guardContext,
          enforcementMode: outputEnforcementMode,
        });
        if (persistenceDecision.warning) {
          log.warn(`[lynx-guardian] Assistant persistence guard diagnostic: ${persistenceDecision.warning}`);
        }
        if (persistenceDecision.block) {
          localConsoleHooks?.beforeMessageWrite({
            occurredAtMs: localConsoleOccurredAtMs,
            sessionKey: normalizeString(ctx.sessionKey) || undefined,
            runId: localConsoleRunId,
            summary: persistenceDecision.warning ?? "Assistant message was blocked before persistence.",
            contentExcerpt: extractMessageText(persistenceDecision.message),
            contentKind: "assistant_message",
            messageRole: nextMessage.role,
            blocked: true,
            enforcementAction: "block",
            payloadJson: {
              messageChanged: nextMessage !== originalMessage,
            },
          });
          return {
            message: persistenceDecision.message,
          };
        }
      }
      if (nextMessage === originalMessage) {
        localConsoleHooks?.beforeMessageWrite({
          occurredAtMs: localConsoleOccurredAtMs,
          sessionKey: normalizeString(ctx.sessionKey) || undefined,
          runId: localConsoleRunId,
          summary: "Assistant message passed through before_message_write without mutation.",
          contentExcerpt: extractMessageText(nextMessage),
          contentKind: "assistant_message",
          messageRole: nextMessage.role,
          messageChanged: false,
          enforcementAction: "allow",
        });
        return;
      }

      log.info("[lynx-guardian] Assistant message decorated before persistence");
      localConsoleHooks?.beforeMessageWrite({
        occurredAtMs: localConsoleOccurredAtMs,
        sessionKey: normalizeString(ctx.sessionKey) || undefined,
        runId: localConsoleRunId,
        summary: "Assistant message was reshaped before persistence.",
        contentExcerpt: extractMessageText(nextMessage),
        contentKind: "assistant_message",
        messageRole: nextMessage.role,
        messageChanged: true,
        enforcementAction: "allow",
      });
      return {
        message: nextMessage,
      };
    } catch (err: any) {
      log.error(`[lynx-guardian] before_message_write handler failed: ${err.message}`);
    }
  });

  api.on("tool_result_persist", (event, ctx) => {
    appendLifecycleProbe("tool_result_persist", event, ctx);
    if (decisionBroker) {
      handleToolResultPersistDecision(decisionBroker, event, ctx);
    }
    const localConsoleOccurredAtMs = Date.now();
    const localConsoleRunId = normalizeString((ctx as any).runId) || undefined;
    if (selfSafetyGuardConfig.resultGuard === false) return;
    const { guardContext } = buildManagedGuardContext(event, ctx);
    const decision = guardToolResultPersistence(event.toolName, event.message, {
      ...guardContext,
      enforcementMode: outputEnforcementMode,
    });
    if (decision.warning) {
      log.warn(`[lynx-guardian] Tool result guard diagnostic: ${decision.warning}`);
    }
    if (!decision.block) {
      localConsoleHooks?.toolResultPersist({
        occurredAtMs: localConsoleOccurredAtMs,
        sessionKey: normalizeString(ctx.sessionKey) || undefined,
        runId: localConsoleRunId,
        toolCallId: normalizeString(event.toolCallId) || undefined,
        toolName: normalizeString(event.toolName) || undefined,
        summary: decision.warning ?? "Tool result passed persistence guard evaluation.",
        contentExcerpt: extractMessageText(event.message),
        contentKind: "tool_result",
        enforcementAction: decision.warning ? "warn" : "allow",
        blocked: false,
      });
      return;
    }
    localConsoleHooks?.toolResultPersist({
      occurredAtMs: localConsoleOccurredAtMs,
      sessionKey: normalizeString(ctx.sessionKey) || undefined,
      runId: localConsoleRunId,
      toolCallId: normalizeString(event.toolCallId) || undefined,
      toolName: normalizeString(event.toolName) || undefined,
      summary: decision.warning ?? "Tool result was blocked before persistence.",
      contentExcerpt: extractMessageText(decision.message),
      contentKind: "tool_result",
      enforcementAction: "block",
      blocked: true,
    });
    return {
      message: decision.message,
    };
  });

  api.on("message_sending", async (event, ctx) => {
    appendLifecycleProbe("message_sending", event, ctx);
    if (decisionBroker) {
      const decisionResult = await handleMessageSendingDecision(decisionBroker, event, ctx);
      if (decisionResult?.cancel) {
        return decisionResult;
      }
    }
    const localConsoleOccurredAtMs = Date.now();
    const localConsoleSessionKey = normalizeString(ctx.sessionKey) || undefined;
    const localConsoleRunId = normalizeString((ctx as any).runId) || undefined;
    const activeManagedLynxCheckRun = localConsoleSessionKey
      ? readLatestPendingLynxCheckRunIntent(localConsoleSessionKey)
      : null;
    const outboundTarget = buildOutboundDeliveryTarget(event, ctx);
    const managedLynxCheckSnapshot = (
      typeof event.content === "string"
      && isTrustedManagedLynxCheckReportText(event.content)
      && activeManagedLynxCheckRun
    )
      ? {
        requestId: activeManagedLynxCheckRun.requestId,
        source: activeManagedLynxCheckRun.source,
        trigger: activeManagedLynxCheckRun.trigger,
        preferredTargetKind: activeManagedLynxCheckRun.preferredTargetKind,
        sessionKey: activeManagedLynxCheckRun.sessionKey,
        targetKey: activeManagedLynxCheckRun.routeHint?.targetKey
          ?? ([
            normalizeString(outboundTarget.messageProvider ?? outboundTarget.channelId),
            normalizeString(outboundTarget.channelId ?? outboundTarget.messageProvider),
            normalizeString(outboundTarget.to ?? outboundTarget.sessionKey),
          ].filter(Boolean).join(":") || undefined),
        channelId: normalizeString(outboundTarget.channelId) || activeManagedLynxCheckRun.routeHint?.channelId,
        messageProvider: normalizeString(outboundTarget.messageProvider) || activeManagedLynxCheckRun.routeHint?.messageProvider,
        status: "running",
        sendAttempted: true,
        transport: "message_sending",
        createdAtMs: activeManagedLynxCheckRun.createdAtMs,
      }
      : undefined;
    let shapedContent: string | undefined;
    if (typeof event.content === "string") {
      const nextContent = appendLocalConsoleWebviewFootnoteForL4Reply(event.content);
      if (nextContent !== event.content.trimEnd()) {
        event.content = nextContent;
        shapedContent = nextContent;
      }
    }
    if (typeof event.content === "string" && isTrustedManagedLynxCheckReportText(event.content)) {
      const nextContent = appendLocalConsoleWebviewFootnote(event.content);
      if (nextContent !== event.content) {
        event.content = nextContent;
        shapedContent = nextContent;
      }
    }
    if (typeof event.content === "string" && resolveOutboundPromptChannel(event, ctx) === "feishu") {
      const nextContent = shapeTextForProvider(event.content, "feishu");
      if (nextContent !== event.content) {
        event.content = nextContent;
        shapedContent = nextContent;
        log.info("[lynx-guardian] Outbound Feishu message shaped at message_sending");
      }
    }
    if (typeof event.content === "string" && isTrustedManagedLynxCheckReportText(event.content)) {
      const nextContent = appendLocalConsoleWebviewFootnote(event.content);
      if (nextContent !== event.content) {
        event.content = nextContent;
        shapedContent = nextContent;
      }
    }

    if (
      isScheduledManagedLynxCheckCronContext(ctx)
      && typeof event.content === "string"
      && isTrustedManagedLynxCheckReportText(event.content)
      && !hasConcreteDeliveryTarget(buildOutboundDeliveryTarget(event, ctx))
    ) {
      log.warn(
        `[lynx-guardian] Cancelled scheduled /lynx-check outbound message without concrete recipient session=${normalizeString(ctx.sessionKey) || "unknown"} target=${normalizeString((event as any)?.to) || "none"}`,
      );
      localConsoleHooks?.messageSending({
        occurredAtMs: localConsoleOccurredAtMs,
        sessionKey: localConsoleSessionKey,
        runId: localConsoleRunId,
        summary: "Scheduled /lynx-check outbound message was cancelled because no concrete recipient was available.",
        contentExcerpt: typeof event.content === "string" ? event.content : undefined,
        contentKind: "outbound_message",
        direction: "output",
        enforcementAction: "block",
        canceled: true,
        targetKey: managedLynxCheckSnapshot?.targetKey,
        lynxCheck: managedLynxCheckSnapshot
          ? {
            ...managedLynxCheckSnapshot,
            status: "failed",
            sendSucceeded: false,
            transport: "cancelled-no-target",
            errorMessage: "No concrete outbound recipient available",
          }
          : undefined,
      });
      return { cancel: true };
    }

    if (selfSafetyGuardConfig.outputGuard === false) {
      localConsoleHooks?.messageSending({
        occurredAtMs: localConsoleOccurredAtMs,
        sessionKey: localConsoleSessionKey,
        runId: localConsoleRunId,
        summary: "Outbound message sending bypassed output guard because it is disabled.",
        contentExcerpt: shapedContent ?? (typeof event.content === "string" ? event.content : undefined),
        contentKind: "outbound_message",
        direction: "output",
        enforcementAction: "allow",
        canceled: false,
        targetKey: managedLynxCheckSnapshot?.targetKey,
        lynxCheck: managedLynxCheckSnapshot as any,
      });
      return shapedContent ? { content: shapedContent } : undefined;
    }
    const { guardContext } = buildManagedGuardContext(event, ctx);
    const enforcement = guardOutputText(event.content, ctx.sessionKey, {
      ...guardContext,
      enforcementMode: outputEnforcementMode,
    }, {
      subject: "outbound message",
    });
    if (enforcement.warning) {
      log.warn(`[lynx-guardian] Outbound guard diagnostic: ${enforcement.warning}`);
    }
    if (enforcement.changed) {
      localConsoleHooks?.messageSending({
        occurredAtMs: localConsoleOccurredAtMs,
        sessionKey: localConsoleSessionKey,
        runId: localConsoleRunId,
        summary: enforcement.warning ?? "Outbound message content was changed by output enforcement.",
        contentExcerpt: enforcement.content,
        contentKind: "outbound_message",
        direction: "output",
        enforcementAction: "redact",
        canceled: false,
        targetKey: managedLynxCheckSnapshot?.targetKey,
        lynxCheck: managedLynxCheckSnapshot as any,
      });
      return { content: enforcement.content };
    }
    localConsoleHooks?.messageSending({
      occurredAtMs: localConsoleOccurredAtMs,
      sessionKey: localConsoleSessionKey,
      runId: localConsoleRunId,
      summary: enforcement.warning ?? "Outbound message passed message_sending evaluation.",
      contentExcerpt: shapedContent ?? (typeof event.content === "string" ? event.content : undefined),
      contentKind: "outbound_message",
      direction: "output",
      enforcementAction: enforcement.warning ? "warn" : "allow",
      canceled: false,
      targetKey: managedLynxCheckSnapshot?.targetKey,
      lynxCheck: managedLynxCheckSnapshot as any,
    });
    return shapedContent ? { content: shapedContent } : undefined;
  });

}
