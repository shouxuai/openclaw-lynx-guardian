
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

export interface PluginConfig {
  enabled?: boolean;
  selfSafetyGuard?: {
    enabled?: boolean;
    inputGuard?: boolean;
    outputGuard?: boolean;
    toolGuard?: boolean;
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

export interface EventContext {
  sessionKey?: string;
  sendMessage?: (message: Message) => Promise<void>;
  terminateSession?: (options: { reason: string; silent: boolean }) => Promise<void>;
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

export interface PatternRule {
  type: string;
  regex: RegExp;
}

export interface OpenClawPluginApi {
  logger: Logger;
  config: PluginConfig;
  on(
    event: "message_received",
    handler: (
      event: MessageReceivedEvent,
      ctx: EventContext
    ) => Promise<void | { block: boolean; blockReason?: string }>
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
    event: string,
    handler: (
      event: any,
      ctx: EventContext
    ) => Promise<void | { block: boolean; blockReason?: string }>
  ): void;
}
