
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

export interface PluginConfig {
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
  input: string; // Assuming input is a string or object with input
  [key: string]: any;
}

export interface AgentEndEvent {
  output: string; // Assuming output is a string or object with output
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
