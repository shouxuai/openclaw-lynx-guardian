import type { OpenClawPluginApi } from "../types.js";
import type { LynxHookRuntimeContext } from "./setup.js";
import * as safetyGuard from "../guard/safety-guard.js";
import { decideRiskAction, localSignalFromAssessment } from "../runtime/risk-decision.js";

export function registerInputHooks(api: OpenClawPluginApi, runtime: LynxHookRuntimeContext): void {
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
  const liveGuardInput = (...args: Parameters<typeof safetyGuard.guardInput>) =>
    safetyGuard.guardInput(...args);
  api.on("before_dispatch", async (event, ctx) => {
    if (decisionBroker) {
      const decisionResult = await handleBeforeDispatchDecision(decisionBroker, event, ctx);
      if ((decisionResult as any)?.block) {
        return {
          handled: true,
          text: (decisionResult as any).blockReason ?? "Blocked by Lynx Guardian decision control plane.",
        };
      }
    }
    const text = normalizeString(event?.content) || "";
    const localApprovalReply = parseLocalToolApprovalReply(text);
    if (localApprovalReply) {
      const channelProfile = resolveChannelProfile(
        ctx?.messageProvider ?? ctx?.channelId ?? ctx?.channel ?? event?.channel,
      );
      if (channelProfile !== "feishu") {
        localConsoleHooks?.beforeDispatch({
          occurredAtMs: Date.now(),
          sessionKey: normalizeString(ctx.sessionKey) || undefined,
          summary: "Observed local approval reply outside Feishu route.",
          localApprovalReply: true,
          specialRoute: "local_approval_reply_non_feishu",
          payloadJson: {
            resolution: localApprovalReply.resolution,
            token: localApprovalReply.token,
            channelProfile,
          },
        });
        return { handled: false };
      }
      log.info(
        `[lynx-guardian] before_dispatch local approval reply token=${localApprovalReply.token ?? "none"} resolution=${localApprovalReply.resolution}`,
      );
      const resolution = resolveFeishuLocalToolApprovalReply({
        event,
        ctx,
        localApprovalReply,
      });
      if (resolution.handled) {
        log.info(
          `[lynx-guardian] before_dispatch consumed local approval reply token=${localApprovalReply.token ?? "none"}`,
        );
        localConsoleHooks?.beforeDispatch({
          occurredAtMs: Date.now(),
          sessionKey: normalizeString(ctx.sessionKey) || undefined,
          summary: "Local approval reply was consumed in before_dispatch.",
          localApprovalReply: true,
          specialRoute: "local_approval_reply_consumed",
          payloadJson: {
            resolution: localApprovalReply.resolution,
            token: localApprovalReply.token,
            handled: true,
          },
        });
        return {
          handled: true,
          text: resolution.replyText,
        };
      }
      log.info(
        `[lynx-guardian] before_dispatch staged local approval replay token=${localApprovalReply.token ?? "none"}`,
      );
      localConsoleHooks?.beforeDispatch({
        occurredAtMs: Date.now(),
        sessionKey: normalizeString(ctx.sessionKey) || undefined,
        summary: "Local approval reply was staged for later replay handling.",
        localApprovalReply: true,
        specialRoute: "local_approval_reply_staged",
        payloadJson: {
          resolution: localApprovalReply.resolution,
          token: localApprovalReply.token,
          handled: false,
        },
      });
      return {
        handled: false,
        text: resolution.replyText,
      };
    }

    rememberInboundRequesterProvenance(event, ctx);

    const channelProfile = resolveChannelProfile(
      ctx?.messageProvider ?? ctx?.channelId ?? ctx?.channel ?? event?.channel,
    );
    if (selfSafetyGuardConfig.inputGuard !== false && text) {
      const guardContext = buildGuardContext(config, event, {
        ...ctx,
        senderId: normalizeString(ctx?.senderId) || normalizeString(event?.senderId),
        channelId: normalizeString(ctx?.channelId ?? ctx?.channel ?? event?.channel) || undefined,
        messageProvider: normalizeString(ctx?.messageProvider ?? ctx?.source) || channelProfile,
      });
      const decision = liveGuardInput(text, ctx.sessionKey ?? event.sessionKey, guardContext);
      const {
        guardActionRequired,
        policyEvaluation,
        policyResolution,
        effectiveAssessment,
        blockReason,
      } = resolveGuardPolicyState(decision);
      const surfaceDecision = decideRiskAction("input", [
        localSignalFromAssessment("input", effectiveAssessment),
      ]);
      log.info(`[lynx-guardian] before_dispatch guardInput decision: ${JSON.stringify(decision)}`);
      logGuardPolicyTrace(log, "before_dispatch", decision, policyResolution);
      if (surfaceDecision.action === "deny") {
        const userFacingBlockReason = appendLogWebviewNoteForL4(blockReason, effectiveAssessment.level);
        localConsoleHooks?.beforeDispatch({
          occurredAtMs: Date.now(),
          sessionKey: normalizeString(ctx.sessionKey ?? event.sessionKey) || undefined,
          summary: blockReason,
          primaryModule: surfaceDecision.primaryModule,
          modules: effectiveAssessment.modules,
          riskLevel: effectiveAssessment.level,
          riskScore: effectiveAssessment.score,
          policyDecision: policyResolution.finalDecision.kind,
          enforcementAction: "block",
          payloadJson: {
            inputGuard: true,
            surfaceAction: surfaceDecision.action,
            userInputPreserved: true,
            legacyRiskLevel: policyEvaluation.legacyRiskLevel,
          },
        });
        log.warn(`[lynx-guardian] Self-safety-guard handled dispatch before model: ${effectiveAssessment.description}`);
        await pushRecordBestEffort(
          {
            id: userId,
            content: buildPolicyRecordContent(
              policyEvaluation,
              `[SSG:before_dispatch] ${effectiveAssessment.modules.join(",")}`,
            ),
            riskLevel: policyEvaluation.legacyRiskLevel,
          },
          {
            log,
            context: "before_dispatch input guard block",
          },
        );
        return {
          handled: true,
          text: userFacingBlockReason,
        };
      }
    }
    if (channelProfile !== "feishu") {
      return { handled: false };
    }

    return { handled: false };
  });


  api.on("message_received", async (event, ctx) => {
    try {
      if (!event.content || event.content.length === 0) return;
      if (decisionBroker) {
        handleMessageReceivedDecision(decisionBroker, event, ctx);
      }
      rememberRecentActiveDeliveryTarget(ctx, { allowRouteOnly: true });
      log.info(`[lynx-guardian] message_received event: ${JSON.stringify(event)}`);
      log.info(`[lynx-guardian] message_received ctx: ${JSON.stringify(ctx)}`);
      const text = typeof event.content === "string"
        ? event.content
        : Array.isArray(event.content)
          ? event.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ")
          : String(event.content);
      log.info(`[lynx-guardian] message_received text: ${text}`);
      if (!text || text.length === 0) return;
      const localConsoleOccurredAtMs = Date.now();
      const lynxCheckTrigger = classifyLynxCheckTrigger(text);

      if (lynxCheckTrigger.kind === "native_passthrough") {
        log.info(`[lynx-guardian] Native check command passthrough: ${text}`);
        localConsoleHooks?.messageReceived({
          occurredAtMs: localConsoleOccurredAtMs,
          sessionKey: normalizeString(ctx.sessionKey) || undefined,
          summary: "Inbound native check command passed through without extra interception.",
          contentExcerpt: text,
          contentKind: "text",
          payloadJson: {
            triggerKind: lynxCheckTrigger.kind,
          },
        });
        return;
      }

      if (lynxCheckTrigger.kind === "lynx_command") {
        log.info(`[lynx-guardian] Manual /lynx-check will be handled in before_agent_start: ${text}`);
        localConsoleHooks?.messageReceived({
          occurredAtMs: localConsoleOccurredAtMs,
          sessionKey: normalizeString(ctx.sessionKey) || undefined,
          summary: "Manual /lynx-check command observed and deferred to before_agent_start.",
          contentExcerpt: text,
          contentKind: "text",
          payloadJson: {
            triggerKind: lynxCheckTrigger.kind,
          },
        });
        return;
      }

      const localApprovalReply = parseLocalToolApprovalReply(text);
      if (localApprovalReply) {
        log.info(
          `[lynx-guardian] message_received observed approval command=${localApprovalReply.command} token=${localApprovalReply.token ?? "none"}; awaiting before_dispatch/native handler`,
        );
        localConsoleHooks?.messageReceived({
          occurredAtMs: localConsoleOccurredAtMs,
          sessionKey: normalizeString(ctx.sessionKey) || undefined,
          summary: "Local approval reply observed at message_received and deferred to dispatch handling.",
          contentExcerpt: text,
          contentKind: "text",
          payloadJson: {
            command: localApprovalReply.command,
            token: localApprovalReply.token,
            resolution: localApprovalReply.resolution,
          },
        });
        return;
      }
      /*
      if (localApprovalReply?.command === "lynx-approve") {
        const sessionKey = normalizeString(ctx.sessionKey) || undefined;
        const actorOuId = resolveActorOuId(event, ctx);
        if (!actorOuId) {
          await sendHookFeedback(ctx, "[Lynx Guardian] 当前审批只接受带 ou_id 的飞书回复。");
          return;
        }

        let localApproval = localApprovalReply.token
          ? readLocalToolApprovalByToken(localApprovalReply.token)
          : undefined;

        if (!localApproval) {
          const candidates = listLocalToolApprovalsForSession({
            sessionKey,
          });
          if (!localApprovalReply.token && candidates.length === 1) {
            [localApproval] = candidates;
          } else if (!localApprovalReply.token && candidates.length > 1) {
            await sendHookFeedback(
              ctx,
              `[Lynx Guardian] 当前有多个待审批操作，请使用完整命令：${LOCAL_TOOL_APPROVAL_COMMAND} <token> allow-once|deny`,
            );
            return;
          }
        }

        if (!localApproval) {
          await sendHookFeedback(ctx, "[Lynx Guardian] 当前没有待审批操作或审批已过期。");
          return;
        }

        if (localApproval.sessionKey && sessionKey && localApproval.sessionKey !== sessionKey) {
          await sendHookFeedback(ctx, "[Lynx Guardian] 当前没有待审批操作或审批已过期。");
          return;
        }

        if (!canActorResolveLocalToolApproval(actorOuId, localApproval)) {
          await sendHookFeedback(
            ctx,
            "[Lynx Guardian] 当前回复的 ou_id 不在本地审批 owner/approver 列表中，无法批准这次操作。",
          );
          return;
        }

        localApproval.resolve(localApprovalReply.resolution);
        await sendHookFeedback(
          ctx,
          localApprovalReply.resolution === "deny"
            ? "[Lynx Guardian] 已拒绝本次操作。"
            : "[Lynx Guardian] 已批准本次操作，原工具调用将继续执行。",
        );
        return;
      }

      */
      if (sensitiveDataBlocker.containsSensitiveData(text)) {
        log.warn("[lynx-guardian] Sensitive data detected in message");
        await pushRecordBestEffort(
          {
            id: userId,
            content: text,
            riskLevel: 1,
          },
          {
            log,
            context: "message sensitive data",
          },
        );
        localConsoleHooks?.messageReceived({
          occurredAtMs: localConsoleOccurredAtMs,
          sessionKey: normalizeString(ctx.sessionKey) || undefined,
          summary: "Sensitive data blocker detected protected content in inbound message.",
          contentExcerpt: text,
          contentKind: "text",
          enforcementAction: "block",
          payloadJson: {
            source: "sensitive_data_blocker",
          },
        });
        await sendHookFeedback(ctx, "Sensitive data detected");
        return;
      }

      rememberInboundRequesterProvenance(event, ctx);

      if (selfSafetyGuardConfig.inputGuard !== false) {
        const inputFingerprint = buildOperationFingerprint({
          sessionKey: ctx.sessionKey,
          actionType: "input",
          payload: text,
        });
        const approvedInputOverride = consumeApprovedOverrideFull(ctx, inputFingerprint);
        log.info(`[lynx-guardian] approvedInputOverride: ${JSON.stringify(approvedInputOverride)}`);
        const guardContext = buildGuardContext(config, event, ctx);
        const decision = liveGuardInput(text, ctx.sessionKey, guardContext);
        const {
          guardActionRequired,
          policyEvaluation,
          policyResolution,
          effectiveAssessment,
          blockReason,
        } = resolveGuardPolicyState(decision);
        log.info(`[lynx-guardian] guardInput decision: ${JSON.stringify(decision)}`);
        logGuardPolicyTrace(log, "message_received", decision, policyResolution);
        const visibleInputWarning = buildVisibleInputGuardWarning({
          assessment: effectiveAssessment,
          policyDecisionKind: policyResolution.finalDecision.kind,
          warning: decision.warning,
        });
        if (guardActionRequired && !approvedInputOverride && !visibleInputWarning) {
          const policyResult = resolveRiskPolicy(effectiveAssessment, riskPolicyConfig);
          const userFacingBlockReason = appendLogWebviewNoteForL4(blockReason, effectiveAssessment.level);
          localConsoleHooks?.messageReceived({
            occurredAtMs: localConsoleOccurredAtMs,
            sessionKey: normalizeString(ctx.sessionKey) || undefined,
            summary: blockReason,
            contentExcerpt: text,
            contentKind: "text",
            primaryModule: effectiveAssessment.modules[0],
            modules: effectiveAssessment.modules,
            riskLevel: effectiveAssessment.level,
            riskScore: effectiveAssessment.score,
            policyDecision: policyResolution.finalDecision.kind,
            enforcementAction: "block",
            payloadJson: {
              approvedInputOverride: Boolean(approvedInputOverride),
              warning: decision.warning,
              legacyRiskLevel: policyEvaluation.legacyRiskLevel,
            },
          });
          log.warn(`[lynx-guardian] Self-safety-guard blocked message: ${effectiveAssessment.description} (${effectiveAssessment.level}, score=${effectiveAssessment.score})`);
          await pushRecordBestEffort(
            {
              id: userId,
              content: buildPolicyRecordContent(
                policyEvaluation,
                `[SSG] ${effectiveAssessment.modules.join(",")}`,
              ),
              riskLevel: policyEvaluation.legacyRiskLevel,
            },
            {
              log,
              context: "message guard block",
            },
          );
          if (resolveOverrideKey(ctx) && policyResult.override.allowed) {
            savePendingOverrideFull(ctx, {
              operationFingerprint: inputFingerprint,
              createdAt: Date.now(),
              expiresAt: Date.now() + riskPolicyConfig.overrideTtlMs,
              actionType: "input",
              replayPayload: { text },
              riskScore: effectiveAssessment.score,
              riskLevel: effectiveAssessment.level,
              matchedModules: effectiveAssessment.modules,
              sourceKeys: resolveOverrideKeys(ctx),
            });
            await sendHookFeedback(
              ctx,
              buildOverridePrompt(
                userFacingBlockReason,
                policyResult.override.confirmationPhrase ?? riskPolicyConfig.confirmationPhrase,
              ),
            );
            return;
          }
          await sendHookFeedback(ctx, userFacingBlockReason);
          return;
        }
        if (visibleInputWarning) {
          log.warn(`[lynx-guardian] Self-safety-guard visible warning: ${effectiveAssessment.description} (${effectiveAssessment.level}, score=${effectiveAssessment.score})`);
          await sendHookFeedback(ctx, visibleInputWarning);
        }
        if (decision.warning) {
          log.warn(`[lynx-guardian] Self-safety-guard warning: ${decision.warning}`);
        }
        localConsoleHooks?.messageReceived({
          occurredAtMs: localConsoleOccurredAtMs,
          sessionKey: normalizeString(ctx.sessionKey) || undefined,
          summary: visibleInputWarning ?? decision.warning ?? "Inbound message passed input guard evaluation.",
          contentExcerpt: text,
          contentKind: "text",
          primaryModule: effectiveAssessment.modules[0],
          modules: effectiveAssessment.modules,
          riskLevel: effectiveAssessment.level,
          riskScore: effectiveAssessment.score,
          policyDecision: policyResolution.finalDecision.kind,
          enforcementAction: visibleInputWarning || decision.warning ? "warn" : "allow",
          payloadJson: {
            approvedInputOverride: Boolean(approvedInputOverride),
            warning: decision.warning,
            visibleInputWarning,
            guardActionRequired,
          },
        });
      }

      // Free-text approval is disabled. Critical non-tool review now happens
      // in the awaited before_agent_start hook so group chat messages do not
      // accidentally consume approval state.
      return;
    } catch (err: any) {
      log.error(`[lynx-guardian] message_received handler failed: ${err.message}`);
    }
  });

  (api.on as any)("before_prompt_build", (event: any, ctx: any) => {
    try {
      appendLifecycleProbe("before_prompt_build", event, ctx);
      if (selfSafetyGuardConfig.inputGuard === false) return;

      const promptBuildGuard = guardPromptBuildInput(event, {
        sessionKey: normalizeString(ctx.sessionKey) || undefined,
        guardContext: buildGuardContext(config, event, ctx) as any,
      });
      if (!promptBuildGuard.blocked) {
        if (promptBuildGuard.prependContext) {
          const assessment = promptBuildGuard.decision?.riskAssessment;
          log.warn(
            `[lynx-guardian] before_prompt_build injected safety context: ${assessment?.description ?? promptBuildGuard.reason ?? "L3 input context"}`,
          );
          localConsoleHooks?.beforeAgentStart({
            occurredAtMs: Date.now(),
            sessionKey: normalizeString(ctx.sessionKey) || undefined,
            runId: normalizeString(ctx.runId) || undefined,
            summary: promptBuildGuard.reason ?? "Prompt build input guard injected safety context.",
            promptText: promptBuildGuard.promptText,
            contentExcerpt: promptBuildGuard.promptText,
            contentKind: "text",
            primaryModule: assessment?.modules[0],
            modules: assessment?.modules,
            riskLevel: assessment?.level as any,
            riskScore: assessment?.score,
            policyDecision: "warn",
            enforcementAction: "warn",
            payloadJson: {
              promptBuildInputGuard: true,
              hookName: "before_prompt_build",
              surfaceAction: "model_context",
            },
          });
          return {
            prependContext: promptBuildGuard.prependContext,
          };
        }
        return;
      }

      const assessment = promptBuildGuard.decision?.riskAssessment;
      log.warn(
        `[lynx-guardian] before_prompt_build injected forced denial context: ${assessment?.description ?? promptBuildGuard.reason ?? "blocked input"}`,
      );
      localConsoleHooks?.beforeAgentStart({
        occurredAtMs: Date.now(),
        sessionKey: normalizeString(ctx.sessionKey) || undefined,
        runId: normalizeString(ctx.runId) || undefined,
        summary: promptBuildGuard.reason ?? "Prompt build input guard injected forced denial context.",
        promptText: promptBuildGuard.promptText,
        contentExcerpt: promptBuildGuard.promptText,
        contentKind: "text",
        primaryModule: assessment?.modules[0],
        modules: assessment?.modules,
        riskLevel: assessment?.level as any,
        riskScore: assessment?.score,
        policyDecision: "deny",
        enforcementAction: "block",
        payloadJson: {
          promptBuildInputGuard: true,
          hookName: "before_prompt_build",
        },
      });
      return {
        systemPrompt: promptBuildGuard.systemPrompt,
        prependContext: promptBuildGuard.prependContext,
      };
    } catch (err: any) {
      log.error(`[lynx-guardian] before_prompt_build handler failed: ${err.message}`);
      return undefined;
    }
  });

  api.on("before_agent_start", async (event, ctx) => {
    try {
      if (!event.prompt && !event.messages) return;
      let pendingBeforeAgentStartDecision:
        | void
        | { block: boolean; blockReason?: string; prependContext?: string } = undefined;
      if (decisionBroker) {
        const decisionResult = await handleBeforeAgentStartDecision(decisionBroker, event, ctx);
        if (decisionResult?.block) {
          pendingBeforeAgentStartDecision = decisionResult;
        }
      }
      const sessionKey = normalizeString(ctx.sessionKey) || undefined;
      const channelId = normalizeString(ctx.channelId) || undefined;
      const promptText = resolveAgentStartPromptText(event);
      const localConsoleOccurredAtMs = Date.now();
      let localConsoleLynxCheckSnapshot: Record<string, unknown> | undefined;
      const normalizedConversationIdInput = resolveChannelProfile(channelId) === "feishu"
        ? normalizeFeishuConversationId(normalizeString((ctx as any).conversationId) || undefined)
        : (normalizeString((ctx as any).conversationId) || undefined);
      const requester = claimRequesterProvenance({
        sessionKey,
      }) ?? readRequesterProvenance({
        sessionKey,
        channelId,
        accountId: normalizeString((ctx as any).accountId) || undefined,
        conversationId: normalizedConversationIdInput,
      });
      const approvalContextSeed = mergeApprovalContextSeed(
        {
          channelProfile: requester?.channelProfile ?? resolveChannelProfile(channelId),
          approvalTransport: requester?.approvalTransport,
          requesterId: requester?.requesterId,
          requesterOuId: requester?.requesterOuId,
          accountId: requester?.accountId ?? (normalizeString(ctx.accountId) || undefined),
          conversationId: requester?.conversationId ?? (normalizeString(ctx.conversationId) || undefined),
          threadId: requester?.threadId ?? ctx.threadId,
          isGroup: requester?.isGroup === true,
        },
        recoverFeishuDmApprovalContextFromRecentRoute(),
      );
      const channelProfile = approvalContextSeed.channelProfile ?? resolveChannelProfile(channelId);
      const approvalTransport = approvalContextSeed.approvalTransport ?? resolveChannelApprovalTransport(channelProfile);
      const normalizedApprovalConversationId = channelProfile === "feishu"
        ? normalizeFeishuConversationId(
            approvalContextSeed.conversationId,
            approvalContextSeed.requesterOuId,
            approvalContextSeed.isGroup,
          )
        : approvalContextSeed.conversationId;
      if (!requester?.requesterOuId && approvalContextSeed.requesterOuId) {
        log.info(
          `[lynx-guardian] Recovered Feishu approval context before_agent_start run=${ctx.runId ?? "no-run"} requester=${approvalContextSeed.requesterOuId} conversation=${normalizedApprovalConversationId ?? approvalContextSeed.conversationId ?? "none"}`,
        );
      }
      if (ctx.runId) {
        saveRunApprovalContext({
          runId: ctx.runId,
          sessionKey,
          channelProfile,
          approvalTransport,
          requesterId: approvalContextSeed.requesterId,
          requesterOuId: approvalContextSeed.requesterOuId,
          accountId: approvalContextSeed.accountId,
          conversationId: normalizedApprovalConversationId,
          promptText,
          threadId: approvalContextSeed.threadId,
          isGroup: approvalContextSeed.isGroup,
          createdAt: Date.now(),
          expiresAt: Date.now() + 30 * 60 * 1000,
        });
      }
      rememberRecentActiveDeliveryTarget(ctx);
      let prependContext = "";
      const localApprovalReply = parseLocalToolApprovalReply(promptText);
      if (
        localApprovalReply
        && (approvalContextSeed.channelProfile ?? resolveChannelProfile(channelId)) === "feishu"
      ) {
        const stagedReplay = consumeFeishuLocalApprovalReplay({
          sessionKey,
          approvalToken: localApprovalReply.token,
        });
        if (stagedReplay) {
          const replayConversationId = normalizeFeishuConversationId(
            stagedReplay.conversationId,
            stagedReplay.requesterOuId,
            approvalContextSeed.isGroup,
          );
          if (ctx.runId) {
            saveRunApprovalContext({
              runId: ctx.runId,
              sessionKey,
              channelProfile: "feishu",
              approvalTransport: "local-chat",
              requesterId: stagedReplay.requesterOuId,
              requesterOuId: stagedReplay.requesterOuId,
              accountId: stagedReplay.accountId ?? approvalContextSeed.accountId,
              conversationId: replayConversationId ?? normalizedApprovalConversationId,
              promptText: stagedReplay.promptText,
              threadId: approvalContextSeed.threadId,
              isGroup: approvalContextSeed.isGroup,
              createdAt: Date.now(),
              expiresAt: Date.now() + 30 * 60 * 1000,
            });
          }
          prependContext += buildFeishuApprovedReplayContext({
            promptText: stagedReplay.promptText,
            requesterOuId: stagedReplay.requesterOuId,
            conversationId: replayConversationId ?? normalizedApprovalConversationId,
          }) + "\n";
        } else {
          const localApprovalResolution = await tryResolveFeishuLocalToolApprovalReply({
            event,
            ctx,
            localApprovalReply,
          });
          if (localApprovalResolution.handled) {
            localConsoleHooks?.beforeAgentStart({
              occurredAtMs: localConsoleOccurredAtMs,
              sessionKey,
              runId: normalizeString(ctx.runId) || undefined,
              promptText,
              summary: localApprovalResolution.blockReason ?? "Local approval reply was consumed before agent start.",
              contentExcerpt: promptText,
              contentKind: "text",
              enforcementAction: "block",
              payloadJson: {
                localApprovalReply: true,
              },
            });
            return {
              block: true,
              blockReason: localApprovalResolution.blockReason ?? "[Lynx Guardian] Local approval reply consumed.",
            };
          }
        }
      }
      let publicAccessResult: any = null;
      const ipInfo = await baseIpInfo();
      if (ipInfo.type == "next_check") {
        const publicAccessCheck = await checkPublicAccessWeighted(userId, ipInfo.ip, ipInfo.port);
        if (!isRemoteAvailable(publicAccessCheck)) {
          log.warn(`[lynx-guardian] Public access weighting unavailable: ${publicAccessCheck.errorMessage}`);
        } else {
          publicAccessResult = publicAccessCheck.value;
          if (publicAccessResult.result.is_public) {
            log.error("[lynx-guardian] Public access check failed");
            const warning = `重要提醒：当前 IP ${ipInfo.ip} 暴露在公网环境，强烈建议配置防火墙规则，仅开放必要端口。\n`;
            prependContext += warning;
          } else {
            log.info("[lynx-guardian] Public access check passed");
          }
        }
      }

      const managedLynxCheckCommandText = resolveManagedLynxCheckCommandText(event);
      const agentStartFingerprint = buildOperationFingerprint({
        sessionKey: ctx.sessionKey,
        actionType: "agent_start",
        payload: promptText,
      });
      const approvedAgentStartOverride = consumeApprovedOverrideFull(ctx, agentStartFingerprint);
      const userInput = extractContentAfterDate(managedLynxCheckCommandText || promptText);
      const managedLynxCheckSource = (
        managedLynxCheckCommandText
        || isManualCompositeLynxCheckRequest(userInput)
      )
        ? resolveManagedLynxCheckSource(ctx)
        : null;
      const managedLynxCheckPreauthorized = managedLynxCheckSource != null
        ? isManagedLynxCheckPreauthorized(managedLynxCheckSource)
        : false;

      if (managedLynxCheckSource) {
        ctx.managedLynxCheckRun = true;
        if (managedLynxCheckPreauthorized) {
          ctx.managedLynxCheckPreauthorized = true;
        }
      }

      if (managedLynxCheckSource) {
        const source = managedLynxCheckSource;
        const routeHint = resolveManagedLynxCheckRouteHint(ctx, source) ?? undefined;
        const runIntent = createLynxCheckRunIntent({
          source,
          trigger: source === "scheduled" ? "scheduled_lynx_check" : "lynx_command",
          preferredTargetKind: source === "scheduled" ? "recent" : "current",
          sessionKey: normalizeString(ctx.sessionKey) || undefined,
          routeHint,
        });

        log.info(
          `[lynx-guardian] Managed /lynx-check run created requestId=${runIntent.requestId} source=${runIntent.source} target=${runIntent.preferredTargetKind}`,
        );
        const reportMarkdown = await buildManualLynxCheckReport({
          log,
          userId,
          ipInfo,
          publicAccessResult,
          discoveryConfig: openClawDiscoveryConfig,
          discoveryRuntimePath: discoveryRuntime.path,
        });
        const reportPath = getLynxCheckRunReportPath(runIntent.requestId);
        ensureParentDirectory(reportPath);
        writeFileSync(reportPath, reportMarkdown, "utf8");
        updateLynxCheckRunIntentStatus(runIntent.requestId, "running");
        writeLynxCheckRunResult(runIntent.requestId, {
          status: "running",
          sendAttempted: false,
          sendSucceeded: false,
          transport: "precomputed",
          reportPath,
        });
        localConsoleLynxCheckSnapshot = {
          requestId: runIntent.requestId,
          source: runIntent.source,
          trigger: runIntent.trigger,
          preferredTargetKind: runIntent.preferredTargetKind,
          sessionKey: runIntent.sessionKey,
          targetKey: runIntent.routeHint?.targetKey,
          channelId: runIntent.routeHint?.channelId,
          messageProvider: runIntent.routeHint?.messageProvider,
          status: "running",
          sendAttempted: false,
          sendSucceeded: false,
          transport: "precomputed",
          reportPath,
          createdAtMs: runIntent.createdAtMs,
        };

        const channel = resolveManagedLynxCheckPromptChannel(ctx, routeHint);
        prependContext += `${
          source === "scheduled"
            ? buildScheduledLynxCheckPrompt({
              requestId: runIntent.requestId,
              reportMarkdown,
              channel,
            })
            : buildManualLynxCheckPrompt({
              requestId: runIntent.requestId,
              reportMarkdown,
              channel,
            })
        }\n`;
      }

      if (managedLynxCheckSource) {
        prependContext += "[system] Do not tell the user to refresh later or check back after a delay. If needed, only state that the plugin will proactively deliver the full report.\n";
      }

      let inputSurfaceAction: ReturnType<typeof decideRiskAction>["action"] | undefined;
      if (selfSafetyGuardConfig.inputGuard !== false && promptText) {
        const guardContext = buildGuardContext(config, event, {
          ...ctx,
          requesterId: approvalContextSeed.requesterId ?? approvalContextSeed.requesterOuId,
          requesterOuId: approvalContextSeed.requesterOuId,
          senderId: normalizeString(ctx?.senderId) || approvalContextSeed.requesterId || approvalContextSeed.requesterOuId,
          senderOpenId: normalizeString((ctx as any)?.senderOpenId) || approvalContextSeed.requesterOuId,
          channelId: normalizeString(ctx?.channelId) || (channelProfile === "other" ? undefined : channelProfile),
          messageProvider: normalizeString((ctx as any)?.messageProvider ?? ctx?.source) || (channelProfile === "other" ? undefined : channelProfile),
          verifiedOwner: approvalContextSeed.requesterOuId
            ? localApprovalApproverOuIds.includes(approvalContextSeed.requesterOuId)
            : ctx?.verifiedOwner,
          managedLynxCheckRun: managedLynxCheckSource != null,
          managedLynxCheckPreauthorized,
        });
        const decision = liveGuardInput(promptText, ctx.sessionKey, guardContext);
        const {
          guardActionRequired,
          policyEvaluation,
          policyResolution,
          effectiveAssessment,
          blockReason,
        } = resolveGuardPolicyState(decision);
        logGuardPolicyTrace(log, "before_agent_start", decision, policyResolution);
        const surfaceDecision = decideRiskAction("input", [
          localSignalFromAssessment("input", effectiveAssessment),
        ]);
        inputSurfaceAction = surfaceDecision.action;
        const visibleInputWarning = buildVisibleInputGuardWarning({
          assessment: effectiveAssessment,
          policyDecisionKind: policyResolution.finalDecision.kind,
          warning: decision.warning,
        });
        const visibleInputWarningContext = buildVisibleInputGuardModelContext({
          assessment: effectiveAssessment,
          policyDecisionKind: policyResolution.finalDecision.kind,
          warning: decision.warning,
        });
        if (visibleInputWarningContext) {
          prependContext += `${visibleInputWarningContext}\n`;
          log.warn(`[lynx-guardian] Self-safety-guard visible agent-start warning: ${effectiveAssessment.description} (${effectiveAssessment.level}, score=${effectiveAssessment.score})`);
          localConsoleHooks?.beforeAgentStart({
            occurredAtMs: localConsoleOccurredAtMs,
            sessionKey,
            runId: normalizeString(ctx.runId) || undefined,
            promptText,
            summary: visibleInputWarning ?? effectiveAssessment.description,
            contentExcerpt: promptText,
            contentKind: "text",
            primaryModule: effectiveAssessment.modules[0],
            modules: effectiveAssessment.modules,
            riskLevel: effectiveAssessment.level,
            riskScore: effectiveAssessment.score,
            policyDecision: policyResolution.finalDecision.kind,
            enforcementAction: "warn",
            lynxCheck: localConsoleLynxCheckSnapshot as any,
            payloadJson: {
              managedLynxCheckPreauthorized,
              legacyRiskLevel: policyEvaluation.legacyRiskLevel,
              visibleInputWarning,
            },
          });
        }
        if (surfaceDecision.action === "model_context") {
          const modelContext = "Input risk is L3. The model may reason over this request with strict context, but tool execution for protected or dangerous actions requires approval.";
          prependContext += `${modelContext}\n`;
          log.warn(`[lynx-guardian] Self-safety-guard L3 agent-start context: ${effectiveAssessment.description}`);
          localConsoleHooks?.beforeAgentStart({
            occurredAtMs: localConsoleOccurredAtMs,
            sessionKey,
            runId: normalizeString(ctx.runId) || undefined,
            promptText,
            summary: modelContext,
            contentExcerpt: promptText,
            contentKind: "text",
            primaryModule: surfaceDecision.primaryModule,
            modules: effectiveAssessment.modules,
            riskLevel: effectiveAssessment.level,
            riskScore: effectiveAssessment.score,
            policyDecision: "warn",
            enforcementAction: "warn",
            lynxCheck: localConsoleLynxCheckSnapshot as any,
            payloadJson: {
              managedLynxCheckPreauthorized,
              surfaceAction: surfaceDecision.action,
              toolExecutionRequiresApproval: true,
              legacyRiskLevel: policyEvaluation.legacyRiskLevel,
            },
          });
        }
        if (surfaceDecision.action === "deny" && !managedLynxCheckPreauthorized && !visibleInputWarningContext) {
          const shouldInjectForcedDenyContext = normalizeString(effectiveAssessment.level) === "L4";
          const isDirectAgentPromptLevelFallback = channelProfile === "other" && shouldInjectForcedDenyContext;
          const userFacingBlockReason = appendLogWebviewNoteForL4(blockReason, effectiveAssessment.level);
          const denyPrependContext = shouldInjectForcedDenyContext
            ? (isDirectAgentPromptLevelFallback
              ? [
                "[Lynx Guardian] Prompt-level fallback active because this OpenClaw runtime does not expose direct-agent physical block semantics.",
                buildForcedAgentStartDenyContext({
                  riskLevel: effectiveAssessment.level,
                  reason: blockReason,
                }),
              ]
              : [
                prependContext.trim(),
                buildForcedAgentStartDenyContext({
                  riskLevel: effectiveAssessment.level,
                  reason: blockReason,
                }),
              ])
              .filter(Boolean)
              .join("\n")
            : prependContext.trim() || undefined;
          if (isDirectAgentPromptLevelFallback) {
            log.warn("[lynx-guardian] before_agent_start L4 denial is prompt-level only in this OpenClaw runtime; physical hard-stop requires a claiming pre-model hook.");
          }
          localConsoleHooks?.beforeAgentStart({
            occurredAtMs: localConsoleOccurredAtMs,
            sessionKey,
            runId: normalizeString(ctx.runId) || undefined,
            promptText,
            summary: blockReason,
            contentExcerpt: promptText,
            contentKind: "text",
            primaryModule: surfaceDecision.primaryModule,
            modules: effectiveAssessment.modules,
            riskLevel: effectiveAssessment.level,
            riskScore: effectiveAssessment.score,
            policyDecision: policyResolution.finalDecision.kind,
            enforcementAction: "block",
            lynxCheck: localConsoleLynxCheckSnapshot as any,
            payloadJson: {
              managedLynxCheckPreauthorized,
              legacyRiskLevel: policyEvaluation.legacyRiskLevel,
              forcedDenyContext: shouldInjectForcedDenyContext,
              ...(isDirectAgentPromptLevelFallback
                ? {
                  physicalHardStopVerified: false,
                  requiredCoreHook: "before_agent_dispatch",
                }
                : {}),
            },
          });
          log.warn(`[lynx-guardian] Self-safety-guard blocked agent start: ${effectiveAssessment.description}`);
          log.info(
            `[lynx-guardian] before_agent_start denyContext injected=${String(shouldInjectForcedDenyContext)} risk=${effectiveAssessment.level}`,
          );
          await pushRecordBestEffort(
            {
              id: userId,
              content: buildPolicyRecordContent(
                policyEvaluation,
                `[SSG:agent_start] ${effectiveAssessment.modules.join(",")}`,
              ),
              riskLevel: policyEvaluation.legacyRiskLevel,
            },
            {
              log,
              context: "agent_start forced deny",
            },
          );
          if (isDirectAgentPromptLevelFallback) {
            if (pendingBeforeAgentStartDecision?.block) {
              return pendingBeforeAgentStartDecision;
            }
            return {
              blockReason: userFacingBlockReason,
              prependContext: denyPrependContext,
            } as any;
          }
          return {
            block: true,
            blockReason: userFacingBlockReason,
            prependContext: denyPrependContext,
          } as any;
        }
        log.info(`[lynx-guardian] guardInput decision: ${JSON.stringify(decision)}`);
        logGuardPolicyTrace(log, "before_agent_start", decision, policyResolution);
        if (guardActionRequired && managedLynxCheckPreauthorized) {
          log.info("[lynx-guardian] Managed /lynx-check preauthorized agent_start passthrough");
        } else if (surfaceDecision.action === "deny" && !approvedAgentStartOverride && !visibleInputWarningContext) {
          const policyResult = resolveRiskPolicy(effectiveAssessment, riskPolicyConfig);
          const userFacingBlockReason = appendLogWebviewNoteForL4(blockReason, effectiveAssessment.level);
          log.warn(`[lynx-guardian] Self-safety-guard blocked agent start: ${effectiveAssessment.description}`);
          await pushRecordBestEffort(
            {
              id: userId,
              content: buildPolicyRecordContent(
                policyEvaluation,
                `[SSG:agent_start] ${effectiveAssessment.modules.join(",")}`,
              ),
              riskLevel: policyEvaluation.legacyRiskLevel,
            },
            {
              log,
              context: "agent_start guard block",
            },
          );
          if (resolveOverrideKey(ctx) && policyResult.override.allowed) {
            localConsoleHooks?.beforeAgentStart({
              occurredAtMs: localConsoleOccurredAtMs,
              sessionKey,
              runId: normalizeString(ctx.runId) || undefined,
              promptText,
              summary: blockReason,
              contentExcerpt: promptText,
              contentKind: "text",
              primaryModule: surfaceDecision.primaryModule,
              modules: effectiveAssessment.modules,
              riskLevel: effectiveAssessment.level,
              riskScore: effectiveAssessment.score,
              policyDecision: policyResolution.finalDecision.kind,
              enforcementAction: "block",
              lynxCheck: localConsoleLynxCheckSnapshot as any,
              payloadJson: {
                managedLynxCheckPreauthorized,
                approvedAgentStartOverride: Boolean(approvedAgentStartOverride),
                overrideAllowed: true,
              },
            });
            savePendingOverrideFull(ctx, {
              operationFingerprint: agentStartFingerprint,
              createdAt: Date.now(),
              expiresAt: Date.now() + riskPolicyConfig.overrideTtlMs,
              actionType: "agent_start",
              replayPayload: { promptText },
              riskScore: effectiveAssessment.score,
              riskLevel: effectiveAssessment.level,
              matchedModules: effectiveAssessment.modules,
              sourceKeys: resolveOverrideKeys(ctx),
            });
            return {
              block: true,
              blockReason: buildOverridePrompt(
                userFacingBlockReason,
                policyResult.override.confirmationPhrase ?? riskPolicyConfig.confirmationPhrase,
              ),
            } as any;
          }
          localConsoleHooks?.beforeAgentStart({
            occurredAtMs: localConsoleOccurredAtMs,
            sessionKey,
            runId: normalizeString(ctx.runId) || undefined,
            promptText,
            summary: blockReason,
            contentExcerpt: promptText,
            contentKind: "text",
            primaryModule: surfaceDecision.primaryModule,
            modules: effectiveAssessment.modules,
            riskLevel: effectiveAssessment.level,
            riskScore: effectiveAssessment.score,
            policyDecision: policyResolution.finalDecision.kind,
            enforcementAction: "block",
            lynxCheck: localConsoleLynxCheckSnapshot as any,
            payloadJson: {
              managedLynxCheckPreauthorized,
              approvedAgentStartOverride: Boolean(approvedAgentStartOverride),
              overrideAllowed: false,
            },
          });
          return {
            block: true,
            blockReason: userFacingBlockReason,
          } as any;
        }
        if (decision.warning && !visibleInputWarningContext) {
          prependContext += `${decision.warning}\n`;
        }
        // 弱信号预警注入：L1/L2 不阻断时，向模型注入安全上下文让模型参与防御
        if (!guardActionRequired && !visibleInputWarningContext) {
          const lvl = effectiveAssessment.level;
          if ((lvl === "L1" || lvl === "L2") && effectiveAssessment.modules.length > 0) {
            const injection = buildSecurityAwarenessInjection(effectiveAssessment.modules);
            if (injection?.hasContent) {
              prependContext += injection.injectionText;
              log.info(`[lynx-guardian] 安全预警注入：modules=${effectiveAssessment.modules.join(",")}`);
            }
          }
        }
      }

      if (pendingBeforeAgentStartDecision?.block) {
        return pendingBeforeAgentStartDecision;
      }

      if (tokenOptimizerConfig.enabled !== false && isTokenOptimizerAvailable()) {
        try {
          let ctxRec = null;
          let modelRec = null;
          let budgetRec = null;

          if (tokenOptimizerConfig.contextOptimizer !== false) {
            ctxRec = await recommendContext(userInput);
            if (ctxRec) {
              log.info(`[lynx-guardian] ${formatContextRecommendation(ctxRec)}`);
            }
          }

          if (tokenOptimizerConfig.modelRouter !== false) {
            modelRec = await routeModel(userInput);
            if (modelRec) {
              log.info(`[lynx-guardian] ${formatModelRouting(modelRec)}`);
            }
          }

          if (tokenOptimizerConfig.budgetTracking !== false) {
            budgetRec = await checkBudget();
            if (budgetRec && budgetRec.status !== "ok") {
              log.warn(`[lynx-guardian] ${formatBudgetStatus(budgetRec)}`);
            }
          }

          const hints = buildOptimizationHints(ctxRec, modelRec, budgetRec, {
            promptText,
            userInput,
          });
          if (hints) {
            prependContext += `${hints}\n`;
          }
        } catch (err: any) {
          log.error(`[lynx-guardian] Token optimizer failed: ${err.message}`);
        }
      }

      const input = extractContentAfterDate(promptText);
      const remoteInputCheck = await checkContentWeighted(userId, input, 1);
      if (!isRemoteAvailable(remoteInputCheck)) {
        log.warn(`[lynx-guardian] Input weighting unavailable: ${remoteInputCheck.errorMessage}`);
      } else {
        const res = remoteInputCheck.value;
        const adaptedContentCheck = adaptContentCheckResult(res.result);
        const inputCategorySummary = [
          adaptedContentCheck.categoryChain.levelOne,
          adaptedContentCheck.categoryChain.levelTwo,
          adaptedContentCheck.categoryChain.levelThree,
        ].join("、");
        log.info(`[lynx-guardian] Input risk detected: ${JSON.stringify(res)}`);
        if (adaptedContentCheck.externalRiskLevel > 0) {
          let warning = `重要提醒：内容包含内容风险（${inputCategorySummary}），\n`;
          if (inputCategorySummary.includes("个人隐私")) {
            warning += "包含隐私内容，需要先进行脱敏处理。";
          } else if (!adaptedContentCheck.categoryChain.levelOne.includes("其他")) {
            warning += "包含价值观相关风险，请进行正向引导。";
          } else {
            warning += "插件已进行拦截。\n";
          }
          log.warn(`[lynx-guardian] Input risk detected: ${warning}`);

          if (adaptedContentCheck.externalRiskLevel >= 3 && managedLynxCheckPreauthorized) {
            log.info("[lynx-guardian] Managed /lynx-check preauthorized API risk passthrough");
          } else if (adaptedContentCheck.externalRiskLevel >= 3 && !approvedAgentStartOverride) {
            const apiAssessment = buildApiRiskAssessment(
              adaptedContentCheck.externalRiskLevel,
              `API input risk: ${adaptedContentCheck.categoryChain.levelOne}/${adaptedContentCheck.categoryChain.levelTwo}/${adaptedContentCheck.categoryChain.levelThree}`,
            );
            const policyResult = resolveRiskPolicy(apiAssessment, riskPolicyConfig);
            if (resolveOverrideKey(ctx) && policyResult.override.allowed) {
              savePendingOverrideFull(ctx, {
                operationFingerprint: agentStartFingerprint,
                createdAt: Date.now(),
                expiresAt: Date.now() + riskPolicyConfig.overrideTtlMs,
                actionType: "agent_start",
                replayPayload: { promptText },
                riskScore: apiAssessment.score,
                riskLevel: apiAssessment.level,
                matchedModules: apiAssessment.modules,
                sourceKeys: resolveOverrideKeys(ctx),
              });
              localConsoleHooks?.beforeAgentStart({
                occurredAtMs: localConsoleOccurredAtMs,
                sessionKey,
                runId: normalizeString(ctx.runId) || undefined,
                promptText,
                summary: `[Lynx Guardian] ${warning}`,
                contentExcerpt: promptText,
                contentKind: "text",
                primaryModule: apiAssessment.modules[0],
                modules: apiAssessment.modules,
                riskLevel: apiAssessment.level,
                riskScore: apiAssessment.score,
                policyDecision: "confirm",
                enforcementAction: "block",
                lynxCheck: localConsoleLynxCheckSnapshot as any,
                payloadJson: {
                  apiRiskLevel: adaptedContentCheck.externalRiskLevel,
                  inputCategorySummary,
                  overrideAllowed: true,
                },
              });
              return {
                block: true,
                blockReason: buildOverridePrompt(
                  `[Lynx Guardian] ${warning}`,
                  policyResult.override.confirmationPhrase ?? riskPolicyConfig.confirmationPhrase,
                ),
              } as any;
            }
            localConsoleHooks?.beforeAgentStart({
              occurredAtMs: localConsoleOccurredAtMs,
              sessionKey,
              runId: normalizeString(ctx.runId) || undefined,
              promptText,
              summary: `[Lynx Guardian] ${warning}`,
              contentExcerpt: promptText,
              contentKind: "text",
              primaryModule: apiAssessment.modules[0],
              modules: apiAssessment.modules,
              riskLevel: apiAssessment.level,
              riskScore: apiAssessment.score,
              policyDecision: "deny",
              enforcementAction: "block",
              lynxCheck: localConsoleLynxCheckSnapshot as any,
              payloadJson: {
                apiRiskLevel: adaptedContentCheck.externalRiskLevel,
                inputCategorySummary,
                overrideAllowed: false,
              },
            });
            return {
              block: true,
              blockReason: `[Lynx Guardian] ${warning}`,
            } as any;
          }
          prependContext += warning;
        }
      }

      localConsoleHooks?.beforeAgentStart({
        occurredAtMs: localConsoleOccurredAtMs,
        sessionKey,
        runId: normalizeString(ctx.runId) || undefined,
        promptText,
        summary: managedLynxCheckSource
          ? "Managed /lynx-check agent start prepared successfully."
          : "Agent start evaluation completed.",
        contentExcerpt: promptText,
        contentKind: "text",
        enforcementAction: prependContext.trim().length > 0 ? "warn" : "allow",
        lynxCheck: localConsoleLynxCheckSnapshot as any,
        payloadJson: {
          managedLynxCheckSource: managedLynxCheckSource ?? undefined,
          managedLynxCheckPreauthorized,
          prependContextLength: prependContext.length,
          publicAccessWarning: publicAccessResult?.result?.is_public === true,
        },
      });
      return {
        prependContext,
      } as any;
    } catch (err: any) {
      log.error(`[lynx-guardian] before_agent_start handler failed: ${err.message}`);
    }
  });
}
