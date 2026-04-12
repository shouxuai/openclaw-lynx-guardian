
import type { OpenClawDiscoveryConfig } from "./discovery/openclaw-discovery.js";

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug?(message: string): void;
}

export interface PluginConfig {
  enabled?: boolean;
  selfSafetyGuard?: {
    enabled?: boolean;
    inputGuard?: boolean;
    outputGuard?: boolean;
    toolGuard?: boolean;
    resultGuard?: boolean;
    ownerVerification?: {
      enabled?: boolean;
      trustedUserIds?: string[];
      trustedChannels?: string[];
    };
    policy?: {
      absoluteRejectScore?: number;
      confirmationPhrase?: string;
      allowOneTimeOverrideLevels?: Array<"L2" | "L3" | "L4">;
      moduleOverrides?: {
        M2?: {
          protectedFileAccess?: { allowOneTimeOverride?: boolean };
        };
        M3?: {
          allowOneTimeOverride?: boolean;
        };
      };
    };
  };
  securityAudit?: {
    enabled?: boolean;
    runOnStartup?: boolean;
    checks?: string[];
    severity?: string;
  };
  skillGuard?: {
    enabled?: boolean;           // default true
    blockMalicious?: boolean;    // default true, block malicious Skills
    verifyIntegrity?: boolean;   // default true, verify Skill integrity on startup
    autoQuarantine?: boolean;    // default false, auto-quarantine requires manual opt-in
  };
  tokenOptimizer?: {
    enabled?: boolean;             // default true
    contextOptimizer?: boolean;    // default true, recommend minimal context per prompt
    modelRouter?: boolean;         // default true, suggest cheaper model tiers
    heartbeatOptimizer?: boolean;  // default true, optimize heartbeat intervals
    budgetTracking?: boolean;      // default true, monitor daily token budget
    dailyBudgetUsd?: number;       // default 5.0, daily spending limit
  };
  scheduledLynxCheck?: {
    enabled?: boolean;
    cron?: string;
    timezone?: string;
    jobName?: string;
    announce?: boolean;
    deliveryMode?: "recent-active" | "announce";
    storePath?: string;
  };
  managedLynxCheckAuthorization?: {
    enabled?: boolean;
    autoGrantOnScheduledJobCreate?: boolean;
    treatManualLynxCheckAsPreauthorized?: boolean;
  };
  openclawDiscovery?: OpenClawDiscoveryConfig;
  [key: string]: any;
}

export interface ContentBlock {
  type: string;
  text?: string;
  [key: string]: any;
}

export interface Message {
  role: string;
  content: string | ContentBlock[];
  sender?: {
    id: string;
    [key: string]: any;
  };
  [key: string]: any;
}

export interface LynxReportDeliveryAttempt {
  targetKey: string;
  sessionKey?: string;
  channelId?: string;
  messageProvider?: string;
  senderId?: string;
  bindingId?: string;
  delivered: boolean;
  transport: string;
  errorMessage?: string;
}

export interface ResolvedMessageTarget {
  targetKey: string;
  sessionKey?: string;
  channelId?: string;
  messageProvider?: string;
  senderId?: string;
  bindingId?: string;
  to?: string;
  accountId?: string;
  threadId?: string | number;
  [key: string]: any;
}

export interface SharedMessageSender {
  send(options: {
    target: ResolvedMessageTarget;
    message: Message;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

export interface EventContext {
  sessionKey?: string;
  sendMessage?: (message: Message) => Promise<void>;
  resolveMessageTarget?: (hint: Partial<ResolvedMessageTarget>) => Promise<ResolvedMessageTarget | null>;
  sharedMessageSender?: SharedMessageSender;
  terminateSession?: (options: { reason: string; silent: boolean }) => Promise<void>;
  managedLynxCheckRun?: boolean;
  managedLynxCheckPreauthorized?: boolean;
  [key: string]: any;
}

export interface ToolCallEvent {
  toolName: string;
  params: Record<string, any>;
}

export interface MessageReceivedEvent {
  content: string | ContentBlock[];
  [key: string]: any;
}

export interface AgentStartEvent {
  prompt?: string | any;
  messages?: Message[];
  [key: string]: any;
}

export interface AgentEndEvent {
  messages?: Message[];
  output?: string;
  [key: string]: any;
}

export interface GatewayStartEvent {
  port?: number;
  [key: string]: any;
}

export interface MessageSendingEvent {
  to: string;
  content: string;
  metadata?: Record<string, unknown>;
  [key: string]: any;
}

export interface MessageSendingResult {
  content?: string;
  cancel?: boolean;
}

export interface BeforeMessageWriteEvent {
  message: Message;
  sessionKey?: string;
  agentId?: string;
  [key: string]: any;
}

export interface BeforeMessageWriteResult {
  block?: boolean;
  message?: Message;
}

export interface ToolResultPersistEvent {
  toolName?: string;
  toolCallId?: string;
  message: Message;
  isSynthetic?: boolean;
}

export interface ToolResultPersistResult {
  message?: Message;
}

export interface PatternRule {
  type: string;
  regex: RegExp;
}

export interface HookApi {
  logger: Logger;
  on(
    event: "message_sending",
    handler: (
      event: MessageSendingEvent,
      ctx: EventContext
    ) => Promise<void | MessageSendingResult>
  ): void;
  on(
    event: "before_message_write",
    handler: (
      event: BeforeMessageWriteEvent,
      ctx: EventContext
    ) => void | BeforeMessageWriteResult
  ): void;
  on(
    event: "tool_result_persist",
    handler: (
      event: ToolResultPersistEvent,
      ctx: EventContext
    ) => void | ToolResultPersistResult
  ): void;
  on(
    event: string,
    handler: (
      event: any,
      ctx: EventContext
    ) => Promise<void> | void
  ): void;
}

export interface OpenClawPluginApi {
  logger: Logger;
  config: PluginConfig;
  on(
    event: "message_received",
    handler: (
      event: MessageReceivedEvent,
      ctx: EventContext
    ) => Promise<void | { block: boolean; blockReason?: string }> | void
  ): void;
  on(
    event: "before_tool_call",
    handler: (
      event: ToolCallEvent,
      ctx: EventContext
    ) => Promise<void | { block: boolean; blockReason?: string }>
  ): void;
  on(
    event: "before_agent_start",
    handler: (
      event: AgentStartEvent,
      ctx: EventContext
    ) => Promise<void | { block: boolean; blockReason?: string; prependContext?: string }>
  ): void;
  on(
    event: "agent_end",
    handler: (
      event: AgentEndEvent,
      ctx: EventContext
    ) => Promise<void>
  ): void;
  on(
    event: "gateway_start",
    handler: (
      event: GatewayStartEvent,
      ctx: EventContext
    ) => Promise<void> | void
  ): void;
  on(
    event: "before_message_write",
    handler: (
      event: BeforeMessageWriteEvent,
      ctx: EventContext
    ) => void | BeforeMessageWriteResult
  ): void;
  on(
    event: "tool_result_persist",
    handler: (
      event: ToolResultPersistEvent,
      ctx: EventContext
    ) => void | ToolResultPersistResult
  ): void;
  on(
    event: "message_sending",
    handler: (
      event: MessageSendingEvent,
      ctx: EventContext
    ) => Promise<void | MessageSendingResult>
  ): void;
  on(
    event: string,
    handler: (
      event: any,
      ctx: EventContext
    ) => Promise<void> | void
  ): void;
}
