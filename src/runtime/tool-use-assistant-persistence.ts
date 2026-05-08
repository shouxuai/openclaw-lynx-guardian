import type { ContentBlock, Message } from "../types.js";

const TOOL_CALL_BLOCK_TYPES = new Set(["toolCall", "toolUse", "functionCall"]);

export function stripToolUseAssistantPreamble<T extends Message>(message: T): T {
  if (
    !message ||
    message.role !== "assistant" ||
    message.stopReason !== "toolUse" ||
    !Array.isArray(message.content)
  ) {
    return message;
  }

  if (!message.content.some(isToolCallBlock)) {
    return message;
  }

  let changed = false;
  const content = message.content.filter((block) => {
    if (isToolCallBlock(block)) {
      return true;
    }

    if (isFinalAnswerTextBlock(block)) {
      return true;
    }

    if (isTextBlock(block) || block.type === "thinking") {
      changed = true;
      return false;
    }

    return true;
  });

  if (!changed) {
    return message;
  }

  return {
    ...message,
    content,
  } as T;
}

function isToolCallBlock(block: ContentBlock): boolean {
  return TOOL_CALL_BLOCK_TYPES.has(block.type);
}

function isTextBlock(block: ContentBlock): boolean {
  return block.type === "text" && typeof block.text === "string";
}

function isFinalAnswerTextBlock(block: ContentBlock): boolean {
  if (!isTextBlock(block) || typeof block.textSignature !== "string") {
    return false;
  }

  try {
    const parsed = JSON.parse(block.textSignature) as { phase?: unknown; v?: unknown };
    return parsed.v === 1 && parsed.phase === "final_answer";
  } catch {
    return false;
  }
}
