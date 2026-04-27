import type { Logger } from "../types.js";
import type { LocalConsoleIngestClient } from "./local-console-client.js";
import { filterRoutineHeartbeatIngestItems } from "./local-console-heartbeat-filter.js";
import {
  createLocalConsoleEventBuilder,
  type AgentEndInput,
  type BeforeAgentStartInput,
  type BeforeDispatchInput,
  type BeforeToolCallInput,
  type GatewayStartInput,
  type LocalConsoleEventBuilder,
  type MessageReceivedInput,
  type MessageSendingInput,
  type MessageWriteInput,
  type SessionLifecycleInput,
  type ToolResultPersistInput,
  type AfterToolCallInput,
} from "./local-console-event-builder.js";

type BuilderOverrides = Partial<LocalConsoleEventBuilder>;

export interface LocalConsoleHookHandlers {
  sessionStart(input: SessionLifecycleInput): void;
  sessionEnd(input: SessionLifecycleInput): void;
  gatewayStart(input: GatewayStartInput): void;
  beforeDispatch(input: BeforeDispatchInput): void;
  messageReceived(input: MessageReceivedInput): void;
  beforeAgentStart(input: BeforeAgentStartInput): void;
  agentEnd(input: AgentEndInput): void;
  beforeMessageWrite(input: MessageWriteInput): void;
  toolResultPersist(input: ToolResultPersistInput): void;
  messageSending(input: MessageSendingInput): void;
  beforeToolCall(input: BeforeToolCallInput): void;
  afterToolCall(input: AfterToolCallInput): void;
}

interface LocalConsoleHookHandlersOptions {
  client: Pick<LocalConsoleIngestClient, "enqueueMany">;
  logger: Pick<Logger, "warn" | "error">;
  builder?: BuilderOverrides;
}

type BuilderMethodName = keyof LocalConsoleEventBuilder;

export function createLocalConsoleHookHandlers(options: LocalConsoleHookHandlersOptions): LocalConsoleHookHandlers {
  const defaultBuilder = createLocalConsoleEventBuilder();
  const builder: LocalConsoleEventBuilder = {
    ...defaultBuilder,
    ...(options.builder ?? {}),
  };

  function emit<K extends BuilderMethodName>(
    methodName: K,
    input: Parameters<LocalConsoleEventBuilder[K]>[0],
  ): void {
    try {
      const items = filterRoutineHeartbeatIngestItems(builder[methodName](input as never));
      if (!items || items.length === 0) {
        return;
      }

      const acceptedCount = options.client.enqueueMany(items);
      if (acceptedCount < items.length) {
        options.logger.warn(
          `[lynx-guardian] local console accepted ${acceptedCount}/${items.length} items for ${String(methodName)}`,
        );
      }
    } catch (error) {
      options.logger.error(
        `[lynx-guardian] local console hook logging failed for ${String(methodName)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    sessionStart(input) {
      emit("sessionStart", input);
    },
    sessionEnd(input) {
      emit("sessionEnd", input);
    },
    gatewayStart(input) {
      emit("gatewayStart", input);
    },
    beforeDispatch(input) {
      emit("beforeDispatch", input);
    },
    messageReceived(input) {
      emit("messageReceived", input);
    },
    beforeAgentStart(input) {
      emit("beforeAgentStart", input);
    },
    agentEnd(input) {
      emit("agentEnd", input);
    },
    beforeMessageWrite(input) {
      emit("beforeMessageWrite", input);
    },
    toolResultPersist(input) {
      emit("toolResultPersist", input);
    },
    messageSending(input) {
      emit("messageSending", input);
    },
    beforeToolCall(input) {
      emit("beforeToolCall", input);
    },
    afterToolCall(input) {
      emit("afterToolCall", input);
    },
  };
}
