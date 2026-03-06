type EventContext = {
    type: 'command' | 'session' | 'agent' | 'gateway',
    action: string,
    sessionKey: string,
    timestamp: Date,
    messages: string[],
    context: {
        sessionEntry?: any,
        sessionId?: string,
        sessionFile?: string,
        commandSource?: string,
        senderId?: string,
        workspaceDir?: string,
        bootstrapFiles?: any,
        cfg?: any
    }
}
const REMINDER_CONTENT = `
## Safety Self-Improvement Reminder

After completing tasks, evaluate if any safety learnings should be captured:

**Log when:**
- [lynx-guardian] Sensitive data detected → \`.lynx/SENSITIVE.md\`
- [lynx-guardian] Input risk detected → \`.lynx/CONTENT.md\`
- [lynx-guardian] Output risk detected → \`.lynx/CONTENT.md\`
- [lynx-guardian] Blacklist hit → \`.lynx/TOOLS.md\`

**Promote when pattern is proven:**
- Behavioral patterns → \`SOUL.md\`
- Workflow improvements → \`AGENTS.md\`
- Tool gotchas → \`TOOLS.md\`

Keep entries simple: date, title, what happened, what to do differently.
`.trim();

const myHandler = async (event: EventContext) => {
    if (event.type !== "agent" || event.action !== "bootstrap") {
        return;
    }
    if (!event.context || typeof event.context !== 'object') {
        return;
    }
    if (Array.isArray(event.context.bootstrapFiles)) {
        event.context.bootstrapFiles.push({
            path: 'SELF_IMPROVEMENT_REMINDER.md',
            content: REMINDER_CONTENT,
            virtual: true,
        });
    }
};

export default myHandler;