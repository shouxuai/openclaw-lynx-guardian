export const OUTBOUND_MESSAGE_PREFIX = "";
export const OUTBOUND_MESSAGE_SUFFIX = "";
export const DISCOVERY_REPORT_HEADER = "\n---\n📡 Lynx Guardian OpenClaw 服务检测报告\n---\n";

function mergeDiscoveryReportText(content: string, report: string): string {
  if (content.includes(report)) {
    return content;
  }

  const existingReportIndex = content.indexOf(DISCOVERY_REPORT_HEADER);
  if (existingReportIndex >= 0) {
    return `${content.slice(0, existingReportIndex)}${report}`;
  }

  return `${content}${report}`;
}

export function decorateOutgoingMessage(content: string): string {
  if (typeof content !== "string" || content.length === 0) {
    return content;
  }
  if (content.startsWith(OUTBOUND_MESSAGE_PREFIX) && content.endsWith(OUTBOUND_MESSAGE_SUFFIX)) {
    return content;
  }
  return `${OUTBOUND_MESSAGE_PREFIX}${content}${OUTBOUND_MESSAGE_SUFFIX}`;
}

export function formatDiscoveryReport(content: string): string {
  if (typeof content !== "string" || content.length === 0) {
    return "";
  }
  return `${DISCOVERY_REPORT_HEADER}${content}`;
}

export function appendDiscoveryReportToContent(content: string, report: string): string {
  if (typeof content !== "string" || content.length === 0 || !report) {
    return content;
  }

  return mergeDiscoveryReportText(content, report);
}

export function appendDiscoveryReportToMessage(message: any, report: string): any {
  if (!message || typeof message !== "object" || message.role !== "assistant" || !report) {
    return message;
  }

  if (typeof message.content === "string") {
    const nextContent = mergeDiscoveryReportText(message.content, report);
    if (nextContent === message.content) {
      return message;
    }
    return {
      ...message,
      content: nextContent,
    };
  }

  if (Array.isArray(message.content)) {
    const lastTextIndex = [...message.content]
      .map((block: any, index: number) => (
        block && typeof block === "object" && block.type === "text" && typeof block.text === "string"
          ? index
          : -1
      ))
      .filter((index: number) => index >= 0)
      .pop();

    if (lastTextIndex == null) {
      return {
        ...message,
        content: [
          ...message.content,
          { type: "text", text: report },
        ],
      };
    }

    const lastTextBlock = message.content[lastTextIndex];
    const nextText = mergeDiscoveryReportText(lastTextBlock?.text ?? "", report);
    if (nextText === lastTextBlock?.text) {
      return message;
    }

    return {
      ...message,
      content: message.content.map((block: any, index: number) => (
        index === lastTextIndex
          ? { ...block, text: nextText }
          : block
      )),
    };
  }

  return message;
}

export function decorateAssistantMessage(message: any): any {
  if (!message || typeof message !== "object" || message.role !== "assistant") {
    return message;
  }

  if (typeof message.content === "string") {
    const decoratedContent = decorateOutgoingMessage(message.content);
    if (decoratedContent === message.content) {
      return message;
    }
    return {
      ...message,
      content: decoratedContent,
    };
  }

  if (Array.isArray(message.content)) {
    let changed = false;
    const textBlockIndexes = message.content
      .map((block: any, index: number) => (
        block && typeof block === "object" && block.type === "text" && typeof block.text === "string"
          ? index
          : -1
      ))
      .filter((index: number) => index >= 0);
    const firstTextIndex = textBlockIndexes[0];
    const lastTextIndex = textBlockIndexes[textBlockIndexes.length - 1];

    const decoratedBlocks = message.content.map((block: any, index: number) => {
      if (!block || typeof block !== "object" || block.type !== "text" || typeof block.text !== "string") {
        return block;
      }

      let nextText = block.text;
      if (index === firstTextIndex && !nextText.startsWith(OUTBOUND_MESSAGE_PREFIX)) {
        nextText = `${OUTBOUND_MESSAGE_PREFIX}${nextText}`;
      }
      if (index === lastTextIndex && !nextText.endsWith(OUTBOUND_MESSAGE_SUFFIX)) {
        nextText = `${nextText}${OUTBOUND_MESSAGE_SUFFIX}`;
      }
      if (nextText === block.text) {
        return block;
      }

      changed = true;
      return {
        ...block,
        text: nextText,
      };
    });

    if (!changed) {
      return message;
    }
    return {
      ...message,
      content: decoratedBlocks,
    };
  }

  return message;
}
