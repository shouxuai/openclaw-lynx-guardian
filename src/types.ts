
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
  [key: string]: any;
}

export interface Message {
  role: string;
  content: string;
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

export interface AgentStartEvent {
  input: string;
  [key: string]: any;
}

export interface AgentEndEvent {
  output: string;
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
    event: "before_tool_call",
    handler: (
      event: ToolCallEvent,
      ctx: EventContext
    ) => Promise<void | { block: boolean; blockReason: string }>
  ): void;
  on(
    event: "before_agent_start",
    handler: (
      event: AgentStartEvent,
      ctx: EventContext
    ) => Promise<void | { block: boolean; blockReason: string }>
  ): void;
  on(
    event: "llm_output",
    handler: (
      event: AgentEndEvent,
      ctx: EventContext
    ) => Promise<void | { block: boolean; blockReason: string }>
  ): void;
  on(
    event: string,
    handler: (
      event: any,
      ctx: EventContext
    ) => Promise<void | { block: boolean; blockReason: string }>
  ): void;
}
