import type { OpenClawPluginApi } from "../types.js";
import type { CheckExecBlacklistContext } from "../blacklist.js";
import type { MaliciousSkillEntry } from "../skills/skill-guard.js";
import type { LynxHookRuntimeContext } from "./setup.js";
import * as blacklist from "../blacklist.js";
import * as safetyGuard from "../guard/safety-guard.js";

export function registerToolHooks(api: OpenClawPluginApi, runtime: LynxHookRuntimeContext): void {
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
    CONFIG,
    checkContentWeighted,
    checkPublicAccessWeighted,
    checkToolWeighted,
    fetchMaliciousSkillBlacklistWeighted,
    getWeightedRiskLevel,
    isRemoteAvailable,
    pushRecordBestEffort,
    registerUserBestEffort,
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
    adaptContentCheckResult,
    adaptToolCheckResult,
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
  const liveGuardToolCall = (...args: Parameters<typeof safetyGuard.guardToolCall>) =>
    safetyGuard.guardToolCall(...args);
  const liveCheckExecBlacklist = (...args: Parameters<typeof blacklist.checkExecBlacklist>) =>
    blacklist.checkExecBlacklist(...args);
  const liveCheckPathBlacklist = (...args: Parameters<typeof blacklist.checkPathBlacklist>) =>
    blacklist.checkPathBlacklist(...args);
  api.on("before_tool_call", async (event, ctx) => {
    const { toolName, params } = event;
    log.info(`[lynx-guardian] before_tool_call tool=${JSON.stringify(toolName)} params=${JSON.stringify(params)}`);
    if (decisionBroker) {
      const decisionResult = await handleBeforeToolCallDecision(decisionBroker, event, ctx);
      if (decisionResult?.block || decisionResult?.requireApproval) {
        return decisionResult;
      }
    }
    const localConsoleOccurredAtMs = Date.now();
    const localConsoleSessionKey = normalizeString(ctx.sessionKey) || undefined;
    const localConsoleRunId = normalizeString((ctx as any).runId) || undefined;
    const localConsoleToolCallId = normalizeString((event as any)?.toolCallId) || undefined;
    const localConsoleParamSummary = buildParamSummary(toolName, params ?? {});
    const recordBeforeToolCall = (overrides: Record<string, unknown> = {}) => {
      localConsoleHooks?.beforeToolCall({
        occurredAtMs: localConsoleOccurredAtMs,
        sessionKey: localConsoleSessionKey,
        runId: localConsoleRunId,
        toolCallId: localConsoleToolCallId,
        toolName,
        params,
        paramSummary: localConsoleParamSummary,
        ...overrides,
      } as any);
    };
    const buildLocalConsoleApproval = (approvalParams: {
      approvalId: string;
      module: string;
      riskLevel: "L2" | "L3";
      transport?: string;
      resolution?: string;
      resolvedAtMs?: number;
      metadataJson?: Record<string, unknown>;
    }) => ({
      approvalId: approvalParams.approvalId,
      pendingId: approvalParams.approvalId,
      sessionKey: localConsoleSessionKey,
      runId: localConsoleRunId,
      transport: approvalParams.transport,
      channelProfile: approvalRoute.channelProfile,
      channelId: approvalRoute.channelId,
      accountId: approvalRoute.accountId,
      conversationId: approvalRoute.conversationId,
      requesterOuId: approvalRoute.requesterOuId,
      approverOuIds: localApprovalApproverOuIds,
      module: approvalParams.module,
      riskLevel: approvalParams.riskLevel,
      toolName,
      scopeType: "singleTool" as const,
      requestedAtMs: localConsoleOccurredAtMs,
      expiresAtMs: localConsoleOccurredAtMs + riskPolicyConfig.toolApprovalTimeoutMs,
      resolvedAtMs: approvalParams.resolvedAtMs,
      resolution: approvalParams.resolution,
      promptExcerpt: runApprovalContext?.promptText,
      metadataJson: approvalParams.metadataJson,
    });
    let execBlacklistContext: CheckExecBlacklistContext | undefined;
    let trustedManagedLynxCheckToolCall = false;
    const toolFingerprint = buildOperationFingerprint({
      sessionKey: ctx.sessionKey,
      actionType: "tool",
      payload: JSON.stringify({
        toolName,
        params: params ?? null,
      }),
    });
    const approvedToolOverride = consumeApprovedOverrideFull(ctx, toolFingerprint);
    const runApprovalContext = readRunApprovalContext(ctx.runId);
    const fallbackFeishuApprovalContext = recoverFeishuDmApprovalContextFromRecentRoute();
    const effectiveRunApprovalContext = mergeApprovalContextSeed(
      {
        channelProfile: runApprovalContext?.channelProfile,
        approvalTransport: runApprovalContext?.approvalTransport,
        requesterId: runApprovalContext?.requesterId,
        requesterOuId: runApprovalContext?.requesterOuId,
        accountId: runApprovalContext?.accountId,
        conversationId: runApprovalContext?.conversationId,
        threadId: runApprovalContext?.threadId,
        isGroup: runApprovalContext?.isGroup === true,
      },
      fallbackFeishuApprovalContext,
    );
    const approvalRoute = buildToolApprovalRoute({
      ctx,
      currentApprovalContext: effectiveRunApprovalContext,
      recoveredFeishuApprovalContext: fallbackFeishuApprovalContext,
      approverOuIds: localApprovalApproverOuIds,
    });
    log.info(`[lynx-guardian] before_tool_call runApprovalContext=${JSON.stringify(runApprovalContext)}`);
    log.info(`[lynx-guardian] before_tool_call effectiveRunApprovalContext=${JSON.stringify(effectiveRunApprovalContext)}`);
    log.info(`[lynx-guardian] before_tool_call approvalRoute=${JSON.stringify({
      compatMode: approvalRoute.compatMode,
      runtimeVersion: approvalRoute.runtimeVersion,
      runtimeTier: approvalRoute.runtimeTier,
      channelProfile: approvalRoute.channelProfile,
      approvalTransport: approvalRoute.approvalTransport,
      requesterOuId: approvalRoute.requesterOuId,
      conversationId: approvalRoute.conversationId,
    })}`);
    if (!runApprovalContext?.requesterOuId && effectiveRunApprovalContext.requesterOuId) {
      log.info(
        `[lynx-guardian] Recovered Feishu approval context before_tool_call run=${ctx.runId ?? "no-run"} requester=${effectiveRunApprovalContext.requesterOuId} conversation=${effectiveRunApprovalContext.conversationId ?? "none"}`,
      );
    }
    log.info(`[lynx-guardian] before_tool_call toolGuardEnabled=${String(selfSafetyGuardConfig.toolGuard !== false)}`);
    if (selfSafetyGuardConfig.toolGuard !== false) {
      try {
        const sessionKey = normalizeString(ctx.sessionKey);
        const activeManagedLynxCheckRun = sessionKey
          ? readLatestPendingLynxCheckRunIntent(sessionKey)
          : null;
        const managedLynxCheckPreauthorized = activeManagedLynxCheckRun != null
          ? isManagedLynxCheckPreauthorized(activeManagedLynxCheckRun.source)
          : false;
        const managedGuardContext = {
          ...ctx,
          requesterId: effectiveRunApprovalContext.requesterId ?? effectiveRunApprovalContext.requesterOuId,
          requesterOuId: effectiveRunApprovalContext.requesterOuId,
          senderId: normalizeString(ctx?.senderId) || effectiveRunApprovalContext.requesterId || effectiveRunApprovalContext.requesterOuId,
          senderOpenId: normalizeString((ctx as any)?.senderOpenId) || effectiveRunApprovalContext.requesterOuId,
          channelId: normalizeString(ctx?.channelId ?? ctx?.channel) || (effectiveRunApprovalContext.channelProfile === "other" ? undefined : effectiveRunApprovalContext.channelProfile),
          messageProvider: normalizeString((ctx as any)?.messageProvider ?? ctx?.source) || (effectiveRunApprovalContext.channelProfile === "other" ? undefined : effectiveRunApprovalContext.channelProfile),
          verifiedOwner: effectiveRunApprovalContext.requesterOuId
            ? localApprovalApproverOuIds.includes(effectiveRunApprovalContext.requesterOuId)
            : ctx?.verifiedOwner,
          managedLynxCheckRun: Boolean(activeManagedLynxCheckRun),
          managedLynxCheckPreauthorized,
        };
        log.info(`[lynx-guardian] before_tool_call managedGuardContext=${JSON.stringify(managedGuardContext)}`);
        log.info(`[lynx-guardian] before_tool_call managedLynxCheckPreauthorized=${JSON.stringify(managedLynxCheckPreauthorized)}`);
        const guardContext = buildGuardContext(config, event, managedGuardContext);
        log.info(`[lynx-guardian] before_tool_call guardContext=${JSON.stringify(guardContext)}`);
        trustedManagedLynxCheckToolCall = guardContext.trustedManagedLynxCheckToolCall === true;
        const decision = liveGuardToolCall(toolName, params, ctx.sessionKey, guardContext);
        const { guardActionRequired, policyEvaluation, policyResolution, effectiveAssessment, blockReason } = resolveGuardPolicyState(decision);
        log.info(`[lynx-guardian] before_tool_call decision=${JSON.stringify(decision)}`);
        logGuardPolicyTrace(log, "before_tool_call", decision, policyResolution);
        execBlacklistContext = decision.contextHints;
        log.info(`[lynx-guardian] before_tool_call execBlacklistContext=${JSON.stringify(execBlacklistContext)}`);
        log.info(`[lynx-guardian] Tool call risk detected: ${JSON.stringify(decision)}`);

        if (guardActionRequired && managedLynxCheckPreauthorized) {
          log.info(`[lynx-guardian] Managed /lynx-check blocked extra tool call outside whitelist: ${toolName}`);
          recordBeforeToolCall({
            summary: "[Lynx Guardian] Managed /lynx-check 已完成预计算，仅允许白名单内的内部读写与报告发送链路。",
            triggeredModules: effectiveAssessment.modules,
            primaryModule: effectiveAssessment.modules[0],
            riskLevel: effectiveAssessment.level,
            riskScore: effectiveAssessment.score,
            policyDecision: "deny",
            enforcementAction: "block",
          });
          return {
            block: true,
            blockReason: "[Lynx Guardian] Managed /lynx-check 已完成预计算，仅允许白名单内的内部读写与报告发送链路。",
          };
        }

        if (guardActionRequired) {
          const policyResult = resolveRiskPolicy(effectiveAssessment, riskPolicyConfig);
          log.warn(`[lynx-guardian] Self-safety-guard blocked tool: ${effectiveAssessment.description}`);
          await pushRecordBestEffort(
            {
              id: userId,
              content: buildPolicyRecordContent(
                policyEvaluation,
                `[SSG:tool] ${toolName} ${effectiveAssessment.modules.join(",")}`,
              ),
              riskLevel: policyEvaluation.legacyRiskLevel,
            },
            {
              log,
              context: "managed tool guard block",
            },
          );

          const approvalRiskLevel = toApprovalRiskLevel(effectiveAssessment.level);
          const primaryModule = effectiveAssessment.modules[0];
          const l4BlockReason = appendLogWebviewNoteForL4(blockReason, effectiveAssessment.level);
          if (!policyResult.override.allowed || !approvalRiskLevel || !primaryModule) {
            recordBeforeToolCall({
              summary: blockReason,
              triggeredModules: effectiveAssessment.modules,
              primaryModule,
              riskLevel: effectiveAssessment.level,
              riskScore: effectiveAssessment.score,
              policyDecision: policyResult.override.allowed ? "confirm" : "deny",
              enforcementAction: "block",
            });
            return {
              block: true,
              blockReason: l4BlockReason,
            };
          }

          if (approvalRoute.compatMode === "deny-no-route") {
            const approvalId = `lynx:ssg:${ctx.runId ?? "no-run"}:${event.toolCallId ?? toolName}:${primaryModule}`;
            const approvalUnavailableReason = appendLogWebviewNoteForL3Approval(
              approvalRoute.blockReason ?? "Approval unavailable",
              approvalRiskLevel,
            );
            recordBeforeToolCall({
              summary: approvalRoute.blockReason ?? "Approval unavailable",
              approvalId,
              triggeredModules: effectiveAssessment.modules,
              primaryModule,
              riskLevel: effectiveAssessment.level,
              riskScore: effectiveAssessment.score,
              policyDecision: policyResult.override.allowed ? "confirm" : "deny",
              enforcementAction: "block",
              approval: buildLocalConsoleApproval({
                approvalId,
                module: primaryModule,
                riskLevel: approvalRiskLevel,
                transport: approvalRoute.approvalTransport,
                metadataJson: {
                  compatMode: approvalRoute.compatMode,
                  runtimeTier: approvalRoute.runtimeTier,
                },
              }),
            });
            return {
              block: true,
              blockReason: approvalUnavailableReason,
            };
          }

          const feishuLocalApproval = await handleFeishuLocalToolApproval({
            ctx: approvalRoute.approvalCtx,
            channelProfile: approvalRoute.channelProfile,
            channelId: approvalRoute.channelId,
            requesterOuId: approvalRoute.requesterOuId,
            conversationId: approvalRoute.conversationId,
            accountId: approvalRoute.accountId,
            approverOuIds: localApprovalApproverOuIds,
            approvalId: `lynx:ssg:${ctx.runId ?? "no-run"}:${event.toolCallId ?? toolName}:${primaryModule}`,
            toolName,
            module: primaryModule,
            riskLevel: approvalRiskLevel,
            promptText: runApprovalContext?.promptText,
            protectedTargetSummary: resolveToolApprovalProtectedTargetSummary(toolName, params),
            timeoutMs: riskPolicyConfig.toolApprovalTimeoutMs,
            grantWindowMs: riskPolicyConfig.grantWindowMs,
            approvalSessionKey: approvalRoute.sessionKey,
          });
          if (feishuLocalApproval.handled) {
            recordBeforeToolCall({
              summary: feishuLocalApproval.blockReason ?? "Feishu local approval flow handled this tool call.",
              approvalId: `lynx:ssg:${ctx.runId ?? "no-run"}:${event.toolCallId ?? toolName}:${primaryModule}`,
              triggeredModules: effectiveAssessment.modules,
              primaryModule,
              riskLevel: effectiveAssessment.level,
              riskScore: effectiveAssessment.score,
              policyDecision: policyResult.override.allowed ? "confirm" : "deny",
              enforcementAction: feishuLocalApproval.blockReason ? "block" : "requireApproval",
              approval: buildLocalConsoleApproval({
                approvalId: `lynx:ssg:${ctx.runId ?? "no-run"}:${event.toolCallId ?? toolName}:${primaryModule}`,
                module: primaryModule,
                riskLevel: approvalRiskLevel,
                transport: "local-chat",
                metadataJson: {
                  localFlow: true,
                },
              }),
            });
            if (feishuLocalApproval.blockReason) {
              return {
                block: true,
                blockReason: appendLogWebviewNoteForL3Approval(feishuLocalApproval.blockReason, approvalRiskLevel),
              };
            }
            return;
          }

          const matchingGrant = matchApprovalGrant({
            channelProfile: approvalRoute.channelProfile,
            channelId: approvalRoute.channelId,
            accountId: approvalRoute.accountId,
            conversationId: approvalRoute.conversationId,
            requesterOuId: approvalRoute.requesterOuId,
            module: primaryModule,
            riskLevel: approvalRiskLevel,
          });
          if (matchingGrant) {
            log.info(
              `[lynx-guardian] approval grant hit source=${approvalRoute.conversationId ?? "none"} module=${primaryModule} risk=${approvalRiskLevel}`,
            );
            recordBeforeToolCall({
              summary: "Existing approval grant matched this tool call.",
              approvalId: `lynx:ssg:${ctx.runId ?? "no-run"}:${event.toolCallId ?? toolName}:${primaryModule}`,
              triggeredModules: effectiveAssessment.modules,
              primaryModule,
              riskLevel: effectiveAssessment.level,
              riskScore: effectiveAssessment.score,
              policyDecision: policyResult.override.allowed ? "confirm" : "deny",
              enforcementAction: "allow",
            });
            return;
          }

          const approvalId = `lynx:ssg:${ctx.runId ?? "no-run"}:${event.toolCallId ?? toolName}:${primaryModule}`;
          const pendingApproval = approvalRoute.approvalTransport === "local-chat"
            ? undefined
            : ctx.runId
            ? getOrCreatePendingToolApproval({
                runId: ctx.runId,
                requesterOuId: approvalRoute.requesterOuId,
                module: primaryModule,
                riskLevel: approvalRiskLevel ?? "L2",
                timeoutMs: riskPolicyConfig.toolApprovalTimeoutMs,
                pendingId: approvalId,
              })
            : undefined;
          if (pendingApproval?.pending && !pendingApproval.created) {
            const resolution = await pendingApproval.pending.wait();
            if (resolution === "allow-once" || resolution === "allow-always") {
              recordBeforeToolCall({
                summary: "Pending approval was reused and resolved to allow the tool call.",
                approvalId,
                triggeredModules: effectiveAssessment.modules,
                primaryModule,
                riskLevel: effectiveAssessment.level,
                riskScore: effectiveAssessment.score,
                policyDecision: policyResult.override.allowed ? "confirm" : "deny",
                enforcementAction: "allow",
                approval: buildLocalConsoleApproval({
                  approvalId,
                  module: primaryModule,
                  riskLevel: approvalRiskLevel,
                  transport: approvalRoute.approvalTransport,
                  resolution,
                  resolvedAtMs: Date.now(),
                }),
              });
              return;
            }
            if (resolution === "deny") {
              recordBeforeToolCall({
                summary: "Pending approval was explicitly denied.",
                approvalId,
                triggeredModules: effectiveAssessment.modules,
                primaryModule,
                riskLevel: effectiveAssessment.level,
                riskScore: effectiveAssessment.score,
                policyDecision: policyResult.override.allowed ? "confirm" : "deny",
                enforcementAction: "block",
                approval: buildLocalConsoleApproval({
                  approvalId,
                  module: primaryModule,
                  riskLevel: approvalRiskLevel,
                  transport: approvalRoute.approvalTransport,
                  resolution,
                  resolvedAtMs: Date.now(),
                }),
              });
              return {
                block: true,
                blockReason: appendLogWebviewNoteForL3Approval("Denied by user", approvalRiskLevel),
              };
            }
            if (resolution === "cancelled") {
              recordBeforeToolCall({
                summary: "Pending approval was cancelled.",
                approvalId,
                triggeredModules: effectiveAssessment.modules,
                primaryModule,
                riskLevel: effectiveAssessment.level,
                riskScore: effectiveAssessment.score,
                policyDecision: policyResult.override.allowed ? "confirm" : "deny",
                enforcementAction: "block",
                approval: buildLocalConsoleApproval({
                  approvalId,
                  module: primaryModule,
                  riskLevel: approvalRiskLevel,
                  transport: approvalRoute.approvalTransport,
                  resolution,
                  resolvedAtMs: Date.now(),
                }),
              });
              return {
                block: true,
                blockReason: appendLogWebviewNoteForL3Approval("Approval cancelled", approvalRiskLevel),
              };
            }
            recordBeforeToolCall({
              summary: "Pending approval timed out.",
              approvalId,
              triggeredModules: effectiveAssessment.modules,
              primaryModule,
              riskLevel: effectiveAssessment.level,
              riskScore: effectiveAssessment.score,
              policyDecision: policyResult.override.allowed ? "confirm" : "deny",
              enforcementAction: "block",
              approval: buildLocalConsoleApproval({
                approvalId,
                module: primaryModule,
                riskLevel: approvalRiskLevel,
                transport: approvalRoute.approvalTransport,
                resolution: "timeout",
                resolvedAtMs: Date.now(),
              }),
            });
            return {
              block: true,
              blockReason: appendLogWebviewNoteForL3Approval("Approval timed out", approvalRiskLevel),
            };
          }
          const { resolveApproval, transport, blockReason: approvalBlockReason } = await prepareToolApprovalHandlers({
            ctx: approvalRoute.approvalCtx,
            channelProfile: approvalRoute.channelProfile,
            channelId: approvalRoute.channelId,
            requesterOuId: approvalRoute.requesterOuId,
            conversationId: approvalRoute.conversationId,
            accountId: approvalRoute.accountId,
            threadId: approvalRoute.threadId,
            preferredTransport: approvalRoute.approvalTransport,
            approverOuIds: localApprovalApproverOuIds,
            approvalId,
            toolName,
            module: primaryModule,
            riskLevel: approvalRiskLevel,
            promptText: runApprovalContext?.promptText,
            protectedTargetSummary: resolveToolApprovalProtectedTargetSummary(toolName, params),
            timeoutMs: riskPolicyConfig.toolApprovalTimeoutMs,
            grantWindowMs: riskPolicyConfig.grantWindowMs,
            pendingApproval,
          });
          if (transport === "blocked") {
            recordBeforeToolCall({
              summary: approvalBlockReason ?? "Approval unavailable",
              approvalId,
              triggeredModules: effectiveAssessment.modules,
              primaryModule,
              riskLevel: effectiveAssessment.level,
              riskScore: effectiveAssessment.score,
              policyDecision: policyResult.override.allowed ? "confirm" : "deny",
              enforcementAction: "block",
              approval: buildLocalConsoleApproval({
                approvalId,
                module: primaryModule,
                riskLevel: approvalRiskLevel,
                transport: approvalRoute.approvalTransport,
              }),
            });
            return {
              block: true,
              blockReason: appendLogWebviewNoteForL3Approval(
                approvalBlockReason ?? "Approval unavailable",
                approvalRiskLevel,
              ),
            };
          }
          if (false && ((
            approvalRoute.channelProfile === "feishu"
          ))) {
            await sendFeishuNativeToolApprovalPrompt({
              ctx: approvalRoute.approvalCtx,
              approvalId,
              requesterOuId: approvalRoute.requesterOuId,
              conversationId: approvalRoute.conversationId,
              accountId: approvalRoute.accountId,
              threadId: approvalRoute.threadId,
              content: buildFeishuNativeToolApprovalReplyPrompt({
                approvalId,
                module: primaryModule,
                riskLevel: approvalRiskLevel ?? "L2",
                toolName,
                timeoutMs: riskPolicyConfig.toolApprovalTimeoutMs,
                confirmationPhrase: riskPolicyConfig.confirmationPhrase ?? "确认放行本次操作",
              }),
            });
          }
          recordBeforeToolCall({
            summary: blockReason,
            approvalId,
            triggeredModules: effectiveAssessment.modules,
            primaryModule,
            riskLevel: effectiveAssessment.level,
            riskScore: effectiveAssessment.score,
            policyDecision: policyResult.override.allowed ? "confirm" : "deny",
            enforcementAction: "requireApproval",
            approval: buildLocalConsoleApproval({
              approvalId,
              module: primaryModule,
              riskLevel: approvalRiskLevel,
              transport: transport === "native" ? "native" : approvalRoute.approvalTransport,
            }),
          });
          return {
            requireApproval: buildToolApprovalRequest({
              toolName,
              module: primaryModule,
              riskLevel: approvalRiskLevel,
              description: blockReason,
              timeoutMs: riskPolicyConfig.toolApprovalTimeoutMs,
              onResolution: resolveApproval,
            }),
          };
        }

        if (guardActionRequired && !approvedToolOverride) {
          const policyResult = resolveRiskPolicy(effectiveAssessment, riskPolicyConfig);
          log.warn(`[lynx-guardian] Self-safety-guard blocked tool: ${effectiveAssessment.description}`);
          await pushRecordBestEffort(
            {
              id: userId,
              content: buildPolicyRecordContent(
                policyEvaluation,
                `[SSG:tool] ${toolName} ${effectiveAssessment.modules.join(",")}`,
              ),
              riskLevel: policyEvaluation.legacyRiskLevel,
            },
            {
              log,
              context: "tool guard block",
            },
          );
          if (resolveOverrideKey(ctx) && policyResult.override.allowed) {
            const alreadyPending = resolveOverrideKeys(ctx).some((k: string) => getPendingOverride(k));
            savePendingOverrideFull(ctx, {
              operationFingerprint: toolFingerprint,
              createdAt: Date.now(),
              expiresAt: Date.now() + riskPolicyConfig.overrideTtlMs,
              actionType: "tool",
              replayPayload: {
                toolName,
                params: params ?? null,
              },
              riskScore: effectiveAssessment.score,
              riskLevel: effectiveAssessment.level,
              matchedModules: effectiveAssessment.modules,
              sourceKeys: resolveOverrideKeys(ctx),
            });

            if (alreadyPending) {
              log.info(`[lynx-guardian] P2: additional block merged into existing pending (${toolName})`);
              return {
                block: true,
                blockReason: `[Lynx Guardian] 已有待确认操作，本次操作${toolName}将在确认后一并放行。`,
              };
            }
            return {
              block: true,
              blockReason: buildOverridePrompt(
                blockReason,
                policyResult.override.confirmationPhrase ?? riskPolicyConfig.confirmationPhrase,
              ),
            };
          }
          recordBeforeToolCall({
            summary: blockReason,
            triggeredModules: effectiveAssessment.modules,
            primaryModule: effectiveAssessment.modules[0],
            riskLevel: effectiveAssessment.level,
            riskScore: effectiveAssessment.score,
            policyDecision: policyResult.override.allowed ? "confirm" : "deny",
            enforcementAction: "block",
          });
          return {
            block: true,
            blockReason,
          };
        }
      } catch (err: any) {
        log.error(`[lynx-guardian] Self-safety-guard tool check error: ${err.message}`);
      }
    }

    if (trustedManagedLynxCheckToolCall) {
      log.info(`[lynx-guardian] Managed /lynx-check trusted tool passthrough: ${toolName}`);
      recordBeforeToolCall({
        summary: "Managed /lynx-check trusted tool call passed through.",
        enforcementAction: "allow",
      });
      return;
    }

    if (skillGuardConfig.enabled !== false && skillGuardConfig.blockMalicious !== false) {
      try {
        const installAttempt = detectSkillInstall(toolName, params);
        if (installAttempt) {
          log.info(`[lynx-guardian] Skill install detected: ${JSON.stringify(installAttempt)}`);
          log.info(`[lynx-guardian] Skill install detected: ${installAttempt.skillName} via ${installAttempt.installMethod}`);

          const quick = quickBlacklistCheck(installAttempt.skillName);
          if (quick.blocked) {
            log.warn(`[lynx-guardian] Malicious Skill blocked: ${installAttempt.skillName} ${quick.reason}`);
            await pushRecordBestEffort(
              {
                id: userId,
                content: `[SkillGuard] blocked: ${installAttempt.skillName} (${quick.reason})`,
                riskLevel: 3,
              },
              {
                log,
                context: "skill guard blocked",
              },
            );
            return {
              block: true,
              blockReason: `[Lynx Guardian] 恶意 Skill 拦截: "${installAttempt.skillName}" ${quick.reason}`,
            };
          }

          const fetchRemote = async (): Promise<MaliciousSkillEntry[] | null> => {
            const remoteBlacklist = await fetchMaliciousSkillBlacklistWeighted();
            if (!isRemoteAvailable(remoteBlacklist)) {
              log.warn(`[lynx-guardian] Remote skill blacklist unavailable: ${remoteBlacklist.errorMessage}`);
              return null;
            }
            const res = remoteBlacklist.value;
            if (res.code === 0 && res.result?.entries) {
              return res.result.entries.map((e: any) => ({
                ...e,
                namePattern: e.namePattern ? new RegExp(e.namePattern) : undefined,
              }));
            }
            return null;
          };

          const assessment = await assessSkillRisk(installAttempt, fetchRemote);
          log.info(`[lynx-guardian] Skill assess risk detected: ${JSON.stringify(assessment)}`);
          if (assessment.block) {
            log.warn(`[lynx-guardian] ${assessment.message}`);
            await pushRecordBestEffort(
              {
                id: userId,
                content: `[SkillGuard] ${assessment.level}: ${installAttempt.skillName}`,
                riskLevel: 3,
              },
              {
                log,
                context: "skill guard assessment block",
              },
            );

            if (skillGuardConfig.autoQuarantine && installAttempt.skillPath) {
              try {
                const { existsSync: existsOnDisk } = await import("fs");
                if (existsOnDisk(installAttempt.skillPath)) {
                  quarantineSkill(installAttempt.skillPath, assessment.reasons.join("; "));
                  log.warn(`[lynx-guardian] Auto-quarantined: ${installAttempt.skillName}`);
                }
              } catch {

              }
            }

            return {
              block: true,
              blockReason: assessment.message,
            };
          }

          if (assessment.level === "warning") {
            log.warn(`[lynx-guardian] ${assessment.message}`);
            await pushRecordBestEffort(
              {
                id: userId,
                content: `[SkillGuard] warning: ${installAttempt.skillName}`,
                riskLevel: 1,
              },
              {
                log,
                context: "skill guard warning",
              },
            );
          }
        }
      } catch (err: any) {
        log.error(`[lynx-guardian] Skill guard check error: ${err.message}`);
      }
    }

    let match = null;
    if (toolName === "exec") {
      const command = (params?.command ?? "") as string;
      match = liveCheckExecBlacklist(typeof command === "string" ? command : "", execBlacklistContext);
    } else if (toolName === "write" || toolName === "edit") {
      const rawPath = (params?.file_path ?? params?.path ?? "") as string;
      log.info(`[lynx-guardian] Raw path: ${rawPath}`);
      const safePath = canonicalizePath(typeof rawPath === "string" ? rawPath : "");
      match = liveCheckPathBlacklist(safePath);
    }
    log.info(`[lynx-guardian] Tool call: ${toolName} | ${JSON.stringify(params)}`);
    if (!match) {
      recordBeforeToolCall({
        summary: "Tool call passed before_tool_call evaluation without blacklist hits.",
        enforcementAction: "allow",
      });
      return;
    }

    log.warn(`[lynx-guardian] Blacklist hit: ${toolName} | ${match.reason}`);

    const detail = toolName === "exec" ? (params?.command ?? "") : (params?.file_path ?? params?.path ?? "");
    const blacklistModules = inferBlacklistModules(toolName, match.reason);
    const contentToReport = toolName === "exec" ? `执行 ${detail} 命令` : `${toolName} ${detail}`;

    const riskLevel = match.level === "critical" ? 3 : 2;
    await pushRecordBestEffort(
      {
        id: userId,
        content: contentToReport,
        riskLevel,
      },
      {
        log,
        context: "blacklist record",
      },
    );

    try {
      const userContext = readRecentContext(ctx.sessionKey);
      log.info(`[lynx-guardian] User context: ${userContext}`);
      const content = `是否${match.reason} ${detail}？用户：${userContext}`;

      const toolCheck = await checkToolWeighted(userId, content);
      const adaptedToolCheck = isRemoteAvailable(toolCheck)
        ? adaptToolCheckResult(toolCheck.value.result)
        : {
            externalRiskLevel: 0,
            content: "",
          };
      if (!isRemoteAvailable(toolCheck)) {
        log.warn(`[lynx-guardian] Tool weighting unavailable: ${toolCheck.errorMessage}`);
      } else {
        log.info(`[lynx-guardian] Tool check result: ${JSON.stringify(toolCheck.value)}`);
      }
      // Blacklist hits always require confirmation via the plugin's pending-override
      // mechanism, even when tool_check returns safe (risk_level=0).
      // "tool_check safe" means the user asked for the operation - that is necessary
      // but not sufficient. The plugin's confirmation phrase is the actual gate.
      // Floor to the blacklist's own severity so we never silently allow a blacklist hit.
      const rawRiskLevel = adaptedToolCheck.externalRiskLevel;
      const blacklistFloor = match.level === "critical" ? 3 : 2;
      const riskLevel = getWeightedRiskLevel({
        localFloor: blacklistFloor,
        remoteRiskLevel: rawRiskLevel,
      });

      log.info(`[lynx-guardian] Tool check result: risk=${rawRiskLevel} (effective=${riskLevel}, blacklistFloor=${blacklistFloor})`);

      if (riskLevel >= 2) {
        const apiAssessment = {
          ...buildApiRiskAssessment(
            riskLevel,
            `API tool risk: ${match.reason}${adaptedToolCheck.content ? ` (${adaptedToolCheck.content})` : ""}`,
          ),
          modules: blacklistModules,
        };
        const policyResult = resolveRiskPolicy(apiAssessment, riskPolicyConfig);
        const approvalRiskLevel = toApprovalRiskLevel(apiAssessment.level);
        const primaryModule = blacklistModules[0];
        if (policyResult.override.allowed && approvalRiskLevel && primaryModule) {
          if (approvalRoute.compatMode === "deny-no-route") {
            const approvalId = `lynx:blacklist:${ctx.runId ?? "no-run"}:${event.toolCallId ?? toolName}:${primaryModule}`;
            recordBeforeToolCall({
              summary: approvalRoute.blockReason ?? "Approval unavailable",
              approvalId,
              triggeredModules: blacklistModules,
              primaryModule,
              riskLevel: apiAssessment.level,
              riskScore: apiAssessment.score,
              policyDecision: "confirm",
              enforcementAction: "block",
              approval: buildLocalConsoleApproval({
                approvalId,
                module: primaryModule,
                riskLevel: approvalRiskLevel,
                transport: approvalRoute.approvalTransport,
                metadataJson: {
                  compatMode: approvalRoute.compatMode,
                  blacklistReason: match.reason,
                },
              }),
            });
            return {
              block: true,
              blockReason: approvalRoute.blockReason ?? "Approval unavailable",
            };
          }

          const approvalId = `lynx:blacklist:${ctx.runId ?? "no-run"}:${event.toolCallId ?? toolName}:${primaryModule}`;
          const feishuLocalApproval = await handleFeishuLocalToolApproval({
            ctx: approvalRoute.approvalCtx,
            channelProfile: approvalRoute.channelProfile,
            channelId: approvalRoute.channelId,
            requesterOuId: approvalRoute.requesterOuId,
            conversationId: approvalRoute.conversationId,
            accountId: approvalRoute.accountId,
            approverOuIds: localApprovalApproverOuIds,
            approvalId,
            toolName,
            module: primaryModule,
            riskLevel: approvalRiskLevel,
            promptText: runApprovalContext?.promptText,
            protectedTargetSummary: resolveToolApprovalProtectedTargetSummary(toolName, params),
            timeoutMs: riskPolicyConfig.toolApprovalTimeoutMs,
            grantWindowMs: riskPolicyConfig.grantWindowMs,
            approvalSessionKey: approvalRoute.sessionKey,
          });
          if (feishuLocalApproval.handled) {
            recordBeforeToolCall({
              summary: feishuLocalApproval.blockReason ?? "Blacklist hit entered Feishu local approval flow.",
              approvalId,
              triggeredModules: blacklistModules,
              primaryModule,
              riskLevel: apiAssessment.level,
              riskScore: apiAssessment.score,
              policyDecision: "confirm",
              enforcementAction: feishuLocalApproval.blockReason ? "block" : "requireApproval",
              approval: buildLocalConsoleApproval({
                approvalId,
                module: primaryModule,
                riskLevel: approvalRiskLevel,
                transport: "local-chat",
                metadataJson: {
                  blacklistReason: match.reason,
                  localFlow: true,
                },
              }),
            });
            if (feishuLocalApproval.blockReason) {
              return {
                block: true,
                blockReason: feishuLocalApproval.blockReason,
              };
            }
            return;
          }

          const matchingGrant = matchApprovalGrant({
            channelProfile: approvalRoute.channelProfile,
            channelId: approvalRoute.channelId,
            accountId: approvalRoute.accountId,
            conversationId: approvalRoute.conversationId,
            requesterOuId: approvalRoute.requesterOuId,
            module: primaryModule,
            riskLevel: approvalRiskLevel,
          });
          if (matchingGrant) {
            log.info(
              `[lynx-guardian] approval grant hit source=${approvalRoute.conversationId ?? "none"} module=${primaryModule} risk=${approvalRiskLevel}`,
            );
            recordBeforeToolCall({
              summary: "Existing approval grant matched blacklist-protected tool call.",
              approvalId,
              triggeredModules: blacklistModules,
              primaryModule,
              riskLevel: apiAssessment.level,
              riskScore: apiAssessment.score,
              policyDecision: "confirm",
              enforcementAction: "allow",
            });
            return;
          }

          log.info(`[lynx-guardian] blacklist approval approvalId=${approvalId}`);
          const pendingApproval = approvalRoute.approvalTransport === "local-chat"
            ? undefined
            : ctx.runId
            ? getOrCreatePendingToolApproval({
                runId: ctx.runId,
                requesterOuId: approvalRoute.requesterOuId,
                module: primaryModule,
                riskLevel: approvalRiskLevel ?? "L2",
                timeoutMs: riskPolicyConfig.toolApprovalTimeoutMs,
                pendingId: approvalId,
              })
            : undefined;
          log.info(`[lynx-guardian] blacklist approval pending=${JSON.stringify(pendingApproval)}`);
          if (pendingApproval?.pending && !pendingApproval.created) {
            const resolution = await pendingApproval.pending.wait();
            log.info(`[lynx-guardian] blacklist approval reused resolution=${JSON.stringify(resolution)}`);
            if (resolution === "allow-once" || resolution === "allow-always") {
              recordBeforeToolCall({
                summary: "Blacklist approval reused an existing allow resolution.",
                approvalId,
                triggeredModules: blacklistModules,
                primaryModule,
                riskLevel: apiAssessment.level,
                riskScore: apiAssessment.score,
                policyDecision: "confirm",
                enforcementAction: "allow",
                approval: buildLocalConsoleApproval({
                  approvalId,
                  module: primaryModule,
                  riskLevel: approvalRiskLevel,
                  transport: approvalRoute.approvalTransport,
                  resolution,
                  resolvedAtMs: Date.now(),
                }),
              });
              return;
            }
            if (resolution === "deny") {
              recordBeforeToolCall({
                summary: "Blacklist approval was denied.",
                approvalId,
                triggeredModules: blacklistModules,
                primaryModule,
                riskLevel: apiAssessment.level,
                riskScore: apiAssessment.score,
                policyDecision: "confirm",
                enforcementAction: "block",
                approval: buildLocalConsoleApproval({
                  approvalId,
                  module: primaryModule,
                  riskLevel: approvalRiskLevel,
                  transport: approvalRoute.approvalTransport,
                  resolution,
                  resolvedAtMs: Date.now(),
                }),
              });
              return { block: true, blockReason: "Denied by user" };
            }
            if (resolution === "cancelled") {
              recordBeforeToolCall({
                summary: "Blacklist approval was cancelled.",
                approvalId,
                triggeredModules: blacklistModules,
                primaryModule,
                riskLevel: apiAssessment.level,
                riskScore: apiAssessment.score,
                policyDecision: "confirm",
                enforcementAction: "block",
                approval: buildLocalConsoleApproval({
                  approvalId,
                  module: primaryModule,
                  riskLevel: approvalRiskLevel,
                  transport: approvalRoute.approvalTransport,
                  resolution,
                  resolvedAtMs: Date.now(),
                }),
              });
              return { block: true, blockReason: "Approval cancelled" };
            }
            recordBeforeToolCall({
              summary: "Blacklist approval timed out.",
              approvalId,
              triggeredModules: blacklistModules,
              primaryModule,
              riskLevel: apiAssessment.level,
              riskScore: apiAssessment.score,
              policyDecision: "confirm",
              enforcementAction: "block",
              approval: buildLocalConsoleApproval({
                approvalId,
                module: primaryModule,
                riskLevel: approvalRiskLevel,
                transport: approvalRoute.approvalTransport,
                resolution: "timeout",
                resolvedAtMs: Date.now(),
              }),
            });
            return { block: true, blockReason: "Approval timed out" };
          }
          log.info(`[lynx-guardian] blacklist approval prepare handlers`);
          const { resolveApproval, transport, blockReason } = await prepareToolApprovalHandlers({
            ctx: approvalRoute.approvalCtx,
            channelProfile: approvalRoute.channelProfile,
            channelId: approvalRoute.channelId,
            requesterOuId: approvalRoute.requesterOuId,
            conversationId: approvalRoute.conversationId,
            accountId: approvalRoute.accountId,
            threadId: approvalRoute.threadId,
            preferredTransport: approvalRoute.approvalTransport,
            approverOuIds: localApprovalApproverOuIds,
            approvalId,
            toolName,
            module: primaryModule,
            riskLevel: approvalRiskLevel,
            promptText: runApprovalContext?.promptText,
            protectedTargetSummary: resolveToolApprovalProtectedTargetSummary(toolName, params),
            timeoutMs: riskPolicyConfig.toolApprovalTimeoutMs,
            grantWindowMs: riskPolicyConfig.grantWindowMs,
            pendingApproval,
          });
          log.info(`[lynx-guardian] blacklist approval transport=${JSON.stringify(transport)}`);
          if (transport === "blocked") {
            recordBeforeToolCall({
              summary: blockReason ?? "Approval unavailable",
              approvalId,
              triggeredModules: blacklistModules,
              primaryModule,
              riskLevel: apiAssessment.level,
              riskScore: apiAssessment.score,
              policyDecision: "confirm",
              enforcementAction: "block",
              approval: buildLocalConsoleApproval({
                approvalId,
                module: primaryModule,
                riskLevel: approvalRiskLevel,
                transport: approvalRoute.approvalTransport,
              }),
            });
            return {
              block: true,
              blockReason: blockReason ?? "Approval unavailable",
            };
          }
          if (false && ((
            approvalRoute.channelProfile === "feishu"
          ))) {
            await sendFeishuNativeToolApprovalPrompt({
              ctx: approvalRoute.approvalCtx,
              approvalId,
              requesterOuId: approvalRoute.requesterOuId,
              conversationId: approvalRoute.conversationId,
              accountId: approvalRoute.accountId,
              threadId: approvalRoute.threadId,
              content: buildFeishuNativeToolApprovalReplyPrompt({
                approvalId,
                module: primaryModule,
                riskLevel: approvalRiskLevel ?? "L2",
                toolName,
                timeoutMs: riskPolicyConfig.toolApprovalTimeoutMs,
                confirmationPhrase: riskPolicyConfig.confirmationPhrase ?? "确认放行本次操作",
              }),
            });
          }
          recordBeforeToolCall({
            summary: `[Lynx Guardian] Risk Level ${riskLevel}: ${match.reason}`,
            approvalId,
            triggeredModules: blacklistModules,
            primaryModule,
            riskLevel: apiAssessment.level,
            riskScore: apiAssessment.score,
            policyDecision: "confirm",
            enforcementAction: "requireApproval",
            approval: buildLocalConsoleApproval({
              approvalId,
              module: primaryModule,
              riskLevel: approvalRiskLevel,
              transport: transport === "native" ? "native" : approvalRoute.approvalTransport,
            }),
          });
          return {
            requireApproval: buildToolApprovalRequest({
              toolName,
              module: primaryModule,
              riskLevel: approvalRiskLevel,
              description: `[Lynx Guardian] Risk Level ${riskLevel}: ${match.reason}`,
              timeoutMs: riskPolicyConfig.toolApprovalTimeoutMs,
              onResolution: resolveApproval,
            }),
          };
        }

        return {
          ...(() => {
            recordBeforeToolCall({
              summary: `[Lynx Guardian] ${riskLevel >= 3 ? "High-risk tool call blocked" : "Tool call blocked"} (Risk Level ${riskLevel}): ${match.reason}`,
              triggeredModules: blacklistModules,
              primaryModule: blacklistModules[0],
              riskLevel: apiAssessment.level,
              riskScore: apiAssessment.score,
              policyDecision: "deny",
              enforcementAction: "block",
            });
            return {};
          })(),
          block: true,
          blockReason: appendLogWebviewNoteForL4(
            `[Lynx Guardian] ${riskLevel >= 3 ? "High-risk tool call blocked" : "Tool call blocked"} (Risk Level ${riskLevel}): ${match.reason}`,
            apiAssessment.level,
          ),
        };
      }

      if (riskLevel >= 2 && !approvedToolOverride) {
        const apiAssessment = {
          ...buildApiRiskAssessment(
            riskLevel,
            `API tool risk: ${match.reason}${adaptedToolCheck.content ? ` (${adaptedToolCheck.content})` : ""}`,
          ),
          modules: blacklistModules,
        };
        const policyResult = resolveRiskPolicy(apiAssessment, riskPolicyConfig);
        if (resolveOverrideKey(ctx) && policyResult.override.allowed) {
          savePendingOverrideFull(ctx, {
            operationFingerprint: toolFingerprint,
            createdAt: Date.now(),
            expiresAt: Date.now() + riskPolicyConfig.overrideTtlMs,
            actionType: "tool",
            replayPayload: {
              toolName,
              params: params ?? null,
            },
            riskScore: apiAssessment.score,
            riskLevel: apiAssessment.level,
            matchedModules: blacklistModules,
            sourceKeys: resolveOverrideKeys(ctx),
          });
          recordBeforeToolCall({
            summary: `[Lynx Guardian] ${riskLevel >= 3 ? "High-risk tool call blocked" : "Confirmation required"} (Risk Level ${riskLevel}): ${match.reason}`,
            triggeredModules: blacklistModules,
            primaryModule: blacklistModules[0],
            riskLevel: apiAssessment.level,
            riskScore: apiAssessment.score,
            policyDecision: "confirm",
            enforcementAction: "block",
          });
          return {
            block: true,
            blockReason: buildOverridePrompt(
              `[Lynx Guardian] ${riskLevel >= 3 ? "High-risk tool call blocked" : "Confirmation required"} (Risk Level ${riskLevel}): ${match.reason}`,
              policyResult.override.confirmationPhrase ?? riskPolicyConfig.confirmationPhrase,
            ),
          };
        }
      }

      if (riskLevel >= 3 && !approvedToolOverride) {
        recordBeforeToolCall({
          summary: `[Lynx Guardian] 高危操作被拦截 (Risk Level ${riskLevel}): ${match.reason}`,
          triggeredModules: blacklistModules,
          primaryModule: blacklistModules[0],
          riskLevel: match.level === "critical" ? "L4" : "L2",
          riskScore: match.level === "critical" ? 9 : 6,
          policyDecision: "deny",
          enforcementAction: "block",
        });
        return {
          block: true,
          blockReason: appendLogWebviewNoteForL4(
            `[Lynx Guardian] 高危操作被拦截 (Risk Level ${riskLevel}): ${match.reason}`,
            match.level === "critical" ? "L4" : "L2",
          ),
        };
      } else if (riskLevel === 2 && !approvedToolOverride) {
        recordBeforeToolCall({
          summary: `[Lynx Guardian] Confirmation required: ${match.reason}. Reply with "同意" and retry.`,
          triggeredModules: blacklistModules,
          primaryModule: blacklistModules[0],
          riskLevel: "L2",
          riskScore: 6,
          policyDecision: "confirm",
          enforcementAction: "block",
        });
        return {
          block: true,
          blockReason: `[Lynx Guardian] Confirmation required: ${match.reason}. Reply with "同意" and retry.`,
        };
      } else if (riskLevel >= 2) {
        log.info(`[lynx-guardian] One-time override consumed for tool risk: ${toolName}`);
        recordBeforeToolCall({
          summary: "One-time override consumed for risky tool call.",
          triggeredModules: blacklistModules,
          primaryModule: blacklistModules[0],
          riskLevel: match.level === "critical" ? "L4" : "L2",
          riskScore: match.level === "critical" ? 9 : 6,
          policyDecision: "allow",
          enforcementAction: "allow",
        });
        return;
      } else if (riskLevel === 1) {
        log.info(`[lynx-guardian] 识别到内容风险：${adaptedToolCheck.content}`);
        recordBeforeToolCall({
          summary: `识别到内容风险：${adaptedToolCheck.content}`,
          triggeredModules: blacklistModules,
          primaryModule: blacklistModules[0],
          riskLevel: "L1",
          riskScore: 3,
          policyDecision: "warn",
          enforcementAction: "warn",
        });
        return;
      } else {
        recordBeforeToolCall({
          summary: "Blacklist-matched tool call was ultimately allowed.",
          triggeredModules: blacklistModules,
          primaryModule: blacklistModules[0],
          riskLevel: "L0",
          riskScore: 0,
          policyDecision: "allow",
          enforcementAction: "allow",
        });
        return;
      }
    } catch (err: any) {
      log.error(`[lynx-guardian] Tool risk handling failed: ${err.message}`);
      if (match.level === "critical") {
        recordBeforeToolCall({
          summary: `[Lynx Guardian] 安全检测失败（高危操作）: ${err.message}`,
          triggeredModules: inferBlacklistModules(toolName, match.reason),
          primaryModule: inferBlacklistModules(toolName, match.reason)[0],
          riskLevel: "L4",
          riskScore: 9,
          policyDecision: "deny",
          enforcementAction: "block",
        });
        return {
          block: true,
          blockReason: appendLogWebviewNoteForL4(
            `[Lynx Guardian] 安全检测失败（高危操作）: ${err.message}`,
            "L4",
          ),
        };
      }
      log.warn(`[lynx-guardian] API unreachable, allowing warning-level operation: ${match.reason}`);
      recordBeforeToolCall({
        summary: `API unreachable, allowing warning-level operation: ${match.reason}`,
        triggeredModules: inferBlacklistModules(toolName, match.reason),
        primaryModule: inferBlacklistModules(toolName, match.reason)[0],
        riskLevel: "L1",
        riskScore: 1,
        policyDecision: "allow",
        enforcementAction: "warn",
      });
      return;
    }
  });

  api.on("after_tool_call", async (event, ctx) => {
    appendLifecycleProbe("after_tool_call", event, ctx);
    localConsoleHooks?.afterToolCall({
      occurredAtMs: Date.now(),
      sessionKey: normalizeString(ctx.sessionKey) || undefined,
      runId: normalizeString((ctx as any).runId) || undefined,
      toolCallId: normalizeString((event as any)?.toolCallId) || undefined,
      toolName: normalizeString((event as any)?.toolName) || "unknown",
      params: (event as any)?.params,
      paramSummary: buildParamSummary(
        normalizeString((event as any)?.toolName) || "unknown",
        ((event as any)?.params ?? {}) as Record<string, unknown>,
      ),
      resultStatus: normalizeString((event as any)?.status) || (normalizeString((event as any)?.errorText) ? "error" : "completed"),
      resultExcerpt: extractMessageText((event as any)?.message) || normalizeString((event as any)?.result) || undefined,
      errorText: normalizeString((event as any)?.errorText)
        || normalizeString((event as any)?.error?.message)
        || undefined,
      durationMs: typeof (event as any)?.durationMs === "number" && Number.isFinite((event as any)?.durationMs)
        ? Math.trunc((event as any).durationMs)
        : undefined,
      finishedAtMs: typeof (event as any)?.finishedAtMs === "number" && Number.isFinite((event as any)?.finishedAtMs)
        ? Math.trunc((event as any).finishedAtMs)
        : Date.now(),
      summary: "Tool call completed and after_tool_call hook observed the result.",
      payloadJson: {
        hookPayloadKeys: Object.keys((event as any) ?? {}),
      },
    });
  });
}
