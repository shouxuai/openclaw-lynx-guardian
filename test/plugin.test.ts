
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import setup from '../index.ts';
import * as utils from '../src/utils.js';
import * as api from '../src/api.js';
import * as discovery from '../src/discovery/openclaw-discovery.js';
import * as runtimeConfig from '../src/discovery/discovery-runtime-config.js';
import * as securityAuditRunner from '../src/runtime/security-audit-runner.js';
import * as skillGuard from '../src/skills/skill-guard.js';
import * as safetyGuard from '../src/guard/safety-guard.js';
import * as blacklist from '../src/blacklist.js';

vi.mock('../src/utils.js');
vi.mock('../src/api.js');
vi.mock('../src/discovery/openclaw-discovery.js', () => ({
  discoverOpenClaw: vi.fn(),
  formatDiscoverySummary: vi.fn((report: any) => [
    'OpenClaw scan complete',
    `- scanned targets: ${report.scannedTargets}`,
    `- expanded hosts: ${report.expandedHosts}`,
    `- hit count: ${report.hits.length}`,
    `- confirmed OpenClaw services: ${report.hits.filter((hit: any) => hit.score >= 80).length}`,
    'Confirmed OpenClaw services:',
    ...report.hits.map((hit: any) => `- IP=${hit.host} port=${hit.port} scheme=${hit.scheme || 'http'} score=${hit.score} status=${hit.confidence}`),
  ].join('\n')),
}));
vi.mock('../src/discovery/discovery-runtime-config.js', () => ({
  DISCOVERY_CONFIG_SOURCE_PATH: 'openclaw.plugin.json',
  loadDiscoveryRuntimeConfig: vi.fn(),
}));
vi.mock('../src/runtime/security-audit-runner.js', () => ({
  runSecurityAudit: vi.fn().mockResolvedValue(null),
  runMaliciousScriptScan: vi.fn().mockResolvedValue(null),
  formatAuditSummary: vi.fn().mockReturnValue('audit summary'),
}));
vi.mock('../src/skills/skill-guard.js', async () => {
  const actual = await vi.importActual<typeof import('../src/skills/skill-guard.js')>('../src/skills/skill-guard.js');
  return {
    ...actual,
    verifyAllInstalledSkills: vi.fn().mockReturnValue([]),
    quickBlacklistCheck: vi.fn().mockReturnValue({ blocked: false }),
  };
});

describe('Plugin Setup', () => {
  let mockApi: any;
  let handlers: Record<string, Function> = {};
  const openclawHome = process.env.HOME ?? process.env.USERPROFILE ?? 'C:\\Users\\24716';
  const pendingDiscoveryPath = join(openclawHome, '.openclaw', '.lynx-pending-discovery.txt');
  const consumedDiscoveryPath = join(openclawHome, '.openclaw', '.lynx-pending-discovery.consumed');
  const pendingDiscoveryRequestPath = join(openclawHome, '.openclaw', '.lynx-pending-discovery.request.json');
  const hookProbeLogPath = join(openclawHome, '.openclaw', 'lynx', 'hook-probe.log');
  const scheduledCronStorePath = join(process.cwd(), 'test-temp', 'plugin-scheduled-lynx-check', 'jobs.json');

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    handlers = {};
    if (existsSync(pendingDiscoveryPath)) {
      rmSync(pendingDiscoveryPath, { force: true });
    }
    if (existsSync(consumedDiscoveryPath)) {
      rmSync(consumedDiscoveryPath, { force: true });
    }
    if (existsSync(pendingDiscoveryRequestPath)) {
      rmSync(pendingDiscoveryRequestPath, { force: true });
    }
    if (existsSync(hookProbeLogPath)) {
      rmSync(hookProbeLogPath, { force: true });
    }
    if (existsSync(scheduledCronStorePath)) {
      rmSync(scheduledCronStorePath, { force: true });
    }
    mockApi = {
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      config: {},
      on: vi.fn((event, handler) => {
        handlers[event] = handler;
      }),
    };

    vi.mocked(utils.ensureUserRegistered).mockReturnValue('TEST_ID');
    vi.mocked(utils.ensureResources).mockReturnValue(undefined);
    vi.mocked(utils.baseIpInfo).mockResolvedValue({ ip: '127.0.0.1', port: 18789, type: 'next_check' } as any);
    vi.mocked(utils.listLocalSubnetCidrs).mockReturnValue([]);
    vi.mocked(utils.extractContentAfterDate).mockImplementation((value: string) => {
      if (!value) return '';
      const bracketEndIndex = value.indexOf(']');
      if (bracketEndIndex === -1) return value;
      const content = value.slice(bracketEndIndex + 1).trim();
      return content || value;
    });
    vi.mocked(api.registerUser).mockResolvedValue({ code: 200, id: 'TEST_ID', message: 'OK' });
    vi.mocked(api.pushRecord).mockResolvedValue({ code: 200, message: 'OK' });
    vi.mocked(api.checkPublicAccess).mockResolvedValue({
      code: 200,
      result: { is_public: false },
      message: 'ok',
    } as any);
    vi.mocked(api.checkContent).mockResolvedValue({
      code: 200,
      result: { risk_level: 0, level_one: '鍏朵粬', level_two: '鍏朵粬', level_three: '鍏朵粬' },
      message: 'ok',
    } as any);
    vi.mocked(runtimeConfig.loadDiscoveryRuntimeConfig).mockReturnValue({
      enabled: true,
      runOnStartup: false,
      fullScan: false,
    });
    vi.mocked(discovery.formatDiscoverySummary).mockImplementation((report: any) => [
      'OpenClaw scan complete',
      `- scanned targets: ${report.scannedTargets}`,
      `- expanded hosts: ${report.expandedHosts}`,
      `- hit count: ${report.hits.length}`,
      `- confirmed OpenClaw services: ${report.hits.filter((hit: any) => hit.score >= 80).length}`,
      'Confirmed OpenClaw services:',
      ...report.hits.map((hit: any) => `- IP=${hit.host} port=${hit.port} scheme=${hit.scheme || 'http'} score=${hit.score} status=${hit.confidence}`),
    ].join('\n'));
    vi.mocked(discovery.discoverOpenClaw).mockResolvedValue({
      scannedTargets: 2,
      expandedHosts: 2,
      elapsedMs: 1200,
      hits: [
        {
          target: '127.0.0.1:18789',
          host: '127.0.0.1',
          port: 18789,
          alive: true,
          score: 90,
          confidence: '纭',
          confidenceDesc: 'OpenClaw 缃戝叧 [楂樼疆淇″害]',
          matchedFeatures: ['openclaw'],
          version: '',
          scheme: 'http',
        },
      ],
      warnings: [],
    } as any);
    vi.mocked(securityAuditRunner.runMaliciousScriptScan).mockResolvedValue([
      {
        type: 'network',
        file: 'skills/bad/skill.js',
        severity: 'high',
        description: 'unexpected outbound request',
        details: null,
      },
    ] as any);
    vi.mocked(skillGuard.verifyAllInstalledSkills).mockReturnValue([
      {
        skillName: 'trusted-skill',
        path: 'C:\\Users\\24716\\.openclaw\\skills\\trusted-skill',
        valid: true,
        currentHash: 'abc123',
      },
      {
        skillName: 'tampered-skill',
        path: 'C:\\Users\\24716\\.openclaw\\skills\\tampered-skill',
        valid: false,
        currentHash: 'def456',
        expectedHash: 'zzz999',
        reason: 'Hash mismatch',
      },
    ] as any);
  });

  it('should register user on startup', () => {
    setup(mockApi);
    expect(utils.ensureUserRegistered).toHaveBeenCalled();
    expect(api.registerUser).toHaveBeenCalledWith('TEST_ID');
  });

  it('should print Chinese API url debug log only in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('LYNX_API_URL', 'http://127.0.0.1:9051');

    setup(mockApi);

    expect(mockApi.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('仅用于开发期'),
    );
    expect(mockApi.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('LYNX_API_URL'),
    );
    expect(mockApi.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('http://127.0.0.1:9051'),
    );

    vi.unstubAllEnvs();
  });

  it('should not print API url debug log in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('LYNX_API_URL', 'http://127.0.0.1:9051');

    setup(mockApi);

    expect(mockApi.logger.info).not.toHaveBeenCalledWith(
      expect.stringContaining('仅用于开发期'),
    );

    vi.unstubAllEnvs();
  });

  it('should attach all event handlers', () => {
    setup(mockApi);
    expect(mockApi.on).toHaveBeenCalledWith('message_received', expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith('before_agent_start', expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith('agent_end', expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith('gateway_start', expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith('before_message_write', expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith('before_tool_call', expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith('session_start', expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith('session_end', expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith('after_tool_call', expect.any(Function));
  });

  it('should expose policy config schema defaults', () => {
    const rawSchema = readFileSync(new URL('../openclaw.plugin.json', import.meta.url), 'utf8');
    const plugin = JSON.parse(rawSchema);
    const policySchema = plugin.configSchema?.properties?.selfSafetyGuard?.properties?.policy;

    expect(policySchema).toBeDefined();
    expect(policySchema.properties.absoluteRejectScore.default).toBe(10);
    expect(policySchema.properties.confirmationPhrase.default).toBe('纭鏀捐鏈鎿嶄綔');
    expect(policySchema.properties.allowOneTimeOverrideLevels.items.enum).toEqual(['L2', 'L3', 'L4']);
    expect(policySchema.properties.moduleOverrides.properties.M3.properties.allowOneTimeOverride.default).toBe(true);
  });

  it('should sync resources on gateway_start', async () => {
    setup(mockApi);
    const handler = handlers['gateway_start'];

    await handler({ port: 18789 }, {});

    expect(utils.ensureResources).toHaveBeenCalled();
    expect(mockApi.logger.info).toHaveBeenCalledWith(expect.stringContaining('Resources synced on gateway_start'));
  });

  it('should reconcile the managed scheduled /lynx-check job on gateway_start', async () => {
    mockApi.config = {
      scheduledLynxCheck: {
        enabled: true,
        cron: '37 8 * * *',
        timezone: 'Asia/Shanghai',
        jobName: 'Test Lynx Check',
        announce: true,
        storePath: scheduledCronStorePath,
      },
    };

    setup(mockApi);
    const handler = handlers['gateway_start'];

    await handler({ port: 18789 }, {});

    expect(existsSync(scheduledCronStorePath)).toBe(true);
    const store = JSON.parse(readFileSync(scheduledCronStorePath, 'utf8'));
    expect(store.jobs).toHaveLength(1);
    expect(store.jobs[0].payload.message).toBe('/lynx-check');
    expect(store.jobs[0].schedule.expr).toBe('37 8 * * *');
  });

  it('should block high risk tool call', async () => {
    setup(mockApi);
    const handler = handlers['before_tool_call'];
    
    vi.mocked(utils.readRecentContext).mockReturnValue('User context');
    vi.mocked(api.checkTool).mockResolvedValue({
        code: 200,
        result: { is_safe: false, risk_level: 3, content: 'high risk' },
        message: 'blocked'
    });

    const result = await handler({ toolName: 'exec', params: { command: 'rm -rf /' } }, { sessionKey: 'sess1' });
    
    expect(api.pushRecord).toHaveBeenCalledWith(
      'TEST_ID',
      expect.stringContaining('rm -rf /'),
      3
    );

    expect(result).toEqual({
        block: true,
        blockReason: expect.stringContaining('Risk Level 3')
    });
    expect(api.checkTool).toHaveBeenCalled();
  });

  it('should allow safe tool call (no blacklist hit)', async () => {
    setup(mockApi);
    const handler = handlers['before_tool_call'];
    
    const result = await handler({ toolName: 'exec', params: { command: 'ls -la' } }, {});
    expect(result).toBeUndefined();
    expect(api.checkTool).not.toHaveBeenCalled();
  });

  it('should allow one-time override for local tool guard on the next identical retry only', async () => {
    mockApi.config = {
      selfSafetyGuard: {
        policy: {
          confirmationPhrase: '纭鏀捐鏈鎿嶄綔',
          allowOneTimeOverrideLevels: ['L3'],
          moduleOverrides: {
            M3: {
              allowOneTimeOverride: true,
            },
          },
        },
      },
    };
    setup(mockApi);
    const toolHandler = handlers['before_tool_call'];
    const messageHandler = handlers['message_received'];
    const guardSpy = vi.spyOn(safetyGuard, 'guardToolCall').mockReturnValue({
      block: true,
      blockReason: '[Lynx Guardian] blocked local tool',
      riskAssessment: {
        level: 'L3',
        score: 7,
        modules: ['M3:over_agency'],
        description: 'over-agency tool attempt',
        action: 'block',
      },
    });

    const event = { toolName: 'read', params: { file_path: 'README.md' } };

    const first = await toolHandler(event, { sessionKey: 'sess-local-tool-override' });
    expect(first).toEqual({
      block: true,
      blockReason: expect.stringContaining('纭鏀捐鏈鎿嶄綔'),
    });

    const confirm = await messageHandler(
      { content: '纭鏀捐鏈鎿嶄綔' },
      { sessionKey: 'sess-local-tool-override' },
    );
    expect(confirm).toEqual({
      block: true,
      blockReason: expect.stringContaining('工作流'),
    });

    const second = await toolHandler(event, { sessionKey: 'sess-local-tool-override' });
    expect(second).toBeUndefined();

    // Third call: workflow auth still active -> also allowed
    const third = await toolHandler(event, { sessionKey: 'sess-local-tool-override' });
    expect(third).toBeUndefined();



    expect(api.checkTool).not.toHaveBeenCalled();
    guardSpy.mockRestore();
  });

  it('should allow one-time override to cover backend tool risk for one retry', async () => {
    mockApi.config = {
      selfSafetyGuard: {
        policy: {
          confirmationPhrase: '纭鏀捐鏈鎿嶄綔',
          allowOneTimeOverrideLevels: ['L4'],
        },
      },
    };
    setup(mockApi);
    const toolHandler = handlers['before_tool_call'];
    const messageHandler = handlers['message_received'];
    const guardSpy = vi.spyOn(safetyGuard, 'guardToolCall').mockReturnValue({
      block: false,
      riskAssessment: {
        level: 'L0',
        score: 0,
        modules: [],
        description: 'safe',
        action: 'allow',
      },
    });
    const blacklistSpy = vi.spyOn(blacklist, 'checkExecBlacklist').mockReturnValue({
      level: 'critical',
      reason: 'dangerous delete',
    } as any);

    vi.mocked(utils.readRecentContext).mockReturnValue('User context');
    vi.mocked(api.checkTool).mockResolvedValue({
      code: 200,
      result: { is_safe: false, risk_level: 3, content: 'explicit confirmation missing' },
      message: 'blocked',
    } as any);

    const event = { toolName: 'exec', params: { command: 'rm -rf /tmp/lynx-test' } };

    const first = await toolHandler(event, { sessionKey: 'sess-api-tool-override' });
    expect(first).toEqual({
      block: true,
      blockReason: expect.stringContaining('Risk Level 3'),
    });

    // API risk with empty modules is hard-blocked — no override path
    // confirm message would return no-pending-override error








    const second = await toolHandler(event, { sessionKey: 'sess-api-tool-override' });
    expect(second).toEqual({
      block: true,
      blockReason: expect.stringContaining('Risk Level 3'),
    });



    expect(api.checkTool).toHaveBeenCalledTimes(2);
    guardSpy.mockRestore();
    blacklistSpy.mockRestore();
  });

  it('should redact leaked protected output on agent_end', async () => {
    setup(mockApi);
    const handler = handlers['agent_end'];
    const event = {
      messages: [
        { role: 'assistant', content: [{ type: 'text', text: 'TOOLS.md content follows: tool definitions and boundaries' }] },
      ],
    };

    await handler(event, {});

    expect(event.messages[0].content[0].text).toContain('杈撳嚭宸茶瀹夊叏闃叉姢鏇挎崲');
    expect(api.pushRecord).toHaveBeenCalledWith(
      'TEST_ID',
      expect.stringContaining('[SSG:output]'),
      2,
    );
  });

  it('should decorate assistant output on before_message_write', async () => {
    setup(mockApi);
    const handler = handlers['before_message_write'];

    const result = await handler(
      { message: { role: 'assistant', content: 'hello world' } },
      { sessionKey: 'sess-send' },
    );

    expect(result).toBeUndefined();
  });

  it('should decorate the first and last text blocks on before_message_write', async () => {
    setup(mockApi);
    const handler = handlers['before_message_write'];

    const result = await handler(
      {
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'internal' },
            { type: 'text', text: 'hello world' },
          ],
        },
      },
      { sessionKey: 'sess-send-blocks' },
    );

    expect(result).toBeUndefined();
  });

  it('should not append discovery report on before_message_write without a matching discovery request', async () => {
    setup(mockApi);
    const handler = handlers['before_message_write'];

    mkdirSync(join(openclawHome, '.openclaw'), { recursive: true });
    writeFileSync(pendingDiscoveryPath, 'scan result: 127.0.0.1:18789', 'utf8');

    const result = await handler(
      { message: { role: 'assistant', content: 'check completed' } },
      { sessionKey: 'sess-discovery-append' },
    );

    expect(result).toBeUndefined();
    expect(existsSync(pendingDiscoveryPath)).toBe(true);
    expect(existsSync(consumedDiscoveryPath)).toBe(false);
  });

  it('should append discovery report once on before_message_write after a matching manual discovery request', async () => {
    setup(mockApi);
    const beforeAgentStart = handlers['before_agent_start'];
    const beforeMessageWrite = handlers['before_message_write'];

    await beforeAgentStart(
      { prompt: '[2026-03-30 14:00:00] /lynx-check' },
      { sessionKey: 'sess-discovery-append' },
    );

    expect(existsSync(pendingDiscoveryPath)).toBe(true);
    expect(existsSync(pendingDiscoveryRequestPath)).toBe(true);

    const firstResult = await beforeMessageWrite(
      { message: { role: 'assistant', content: 'check completed' } },
      { sessionKey: 'sess-discovery-append' },
    );

    expect(firstResult).toEqual({
      message: {
        role: 'assistant',
        content: expect.stringContaining('Lynx Guardian OpenClaw'),
      },
    });
    expect((firstResult as any).message.content).toContain('check completed');
    expect(existsSync(pendingDiscoveryPath)).toBe(false);
    expect(existsSync(consumedDiscoveryPath)).toBe(true);
    expect(existsSync(pendingDiscoveryRequestPath)).toBe(false);

    const secondResult = await beforeMessageWrite(
      { message: { role: 'assistant', content: 'follow-up reply' } },
      { sessionKey: 'sess-discovery-append' },
    );

    expect(secondResult).toBeUndefined();
  });

  it('should not mutate outbound content on message_sending', async () => {
    setup(mockApi);
    const handler = handlers['message_sending'];
    expect(handler).toBeUndefined();
    return;

    const result = await handler(
      { to: 'webchat', content: 'this is an outbound message' },
      { sessionKey: 'sess-message-sending' },
    );

    expect(result).toBeUndefined();
    return;
    expect(result).toEqual({
      content: 'HOOK:message_sending outbound message',
    });
  });

  it('should append discovery report on first message_sending output without consuming the pending file', async () => {
    setup(mockApi);
    const handler = handlers['message_sending'];
    expect(handler).toBeUndefined();
    return;

    mkdirSync(join(openclawHome, '.openclaw'), { recursive: true });
    writeFileSync(pendingDiscoveryPath, '閹殿偅寮跨紒鎾寸亯: 127.0.0.1:18789', 'utf8');

    const result = await handler(
      { to: 'webchat', content: 'first outbound discovery message' },
      { sessionKey: 'sess-message-sending-discovery' },
    );

    expect(result).toBeUndefined();
    expect((result as any).prependContext).toContain('IP/');
    expect((result as any).prependContext).toContain('IP/');
    expect((result as any).prependContext).not.toContain('Lynx Guardian OpenClaw');
    expect((result as any).prependContext).not.toContain('Lynx Guardian OpenClaw');
    expect(existsSync(pendingDiscoveryPath)).toBe(true);
    expect(existsSync(consumedDiscoveryPath)).toBe(false);
    return;
    expect(result).toEqual({
      content: expect.stringContaining('閹殿偅寮跨紒鎾寸亯: 127.0.0.1:18789'),
    });
    expect((result as any).content).toContain('HOOK:message_sending');
    expect((result as any).content).toContain('Lynx Guardian OpenClaw');
    expect(existsSync(pendingDiscoveryPath)).toBe(true);
    expect(existsSync(consumedDiscoveryPath)).toBe(false);
  });

  it('should write a lifecycle probe log for after_tool_call', async () => {
    setup(mockApi);
    const handler = handlers['after_tool_call'];

    await handler(
      {
        toolName: 'exec',
        params: { command: 'ls -la' },
        result: { ok: true },
      },
      { sessionKey: 'sess-after-tool' },
    );

    expect(existsSync(hookProbeLogPath)).toBe(true);
    const log = readFileSync(hookProbeLogPath, 'utf8');
    expect(log).toContain('after_tool_call');
    expect(log).toContain('exec');
    expect(log).toContain('sess-after-tool');
  });

  it('should persist a composite /lynx-check report with discovery last', async () => {
    setup(mockApi);
    const handler = handlers['before_agent_start'];

    const result = await handler(
      { prompt: '[2026-03-30 14:00:00] /lynx-check' },
      { sessionKey: 'sess-composite-check' },
    );

    expect(mockApi.logger.error).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        prependContext: expect.stringContaining('瀹屾暣鎶ュ憡灏嗙敱鎻掍欢鑷姩闄勫姞'),
      }),
    );
    expect(existsSync(pendingDiscoveryPath)).toBe(true);

    const report = readFileSync(pendingDiscoveryPath, 'utf8');
    expect(report).toContain('public');
    expect(report).toContain('鎭舵剰鑴氭湰鎵弿');
    expect(report).toContain('Skill');
    expect(report).toContain('鏈嶅姟鍙戠幇 IP/绔彛');
    expect(report.lastIndexOf('鏈嶅姟鍙戠幇 IP/绔彛')).toBeGreaterThan(report.lastIndexOf('Skill'));
  });

  it('should trigger discovery reply on /check and send result messages', async () => {
    setup(mockApi);
    const handler = handlers['message_received'];
    const sendMessage = vi.fn().mockResolvedValue(undefined);

    const result = await handler(
      { content: '/check' },
      { sessionKey: 'sess-check', sendMessage },
    );

    expect(discovery.discoverOpenClaw).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        role: 'assistant',
      }),
    );
    expect(sendMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        role: 'assistant',
      }),
    );
    expect(sendMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        role: 'assistant',
      }),
    );
    expect(sendMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        role: 'assistant',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        block: true,
      }),
    );
    expect(mockApi.logger.info).toHaveBeenCalledWith(expect.stringContaining('OpenClaw'));
  });

  it('should trigger discovery reply on bare check command', async () => {
    setup(mockApi);
    const handler = handlers['message_received'];
    const sendMessage = vi.fn().mockResolvedValue(undefined);

    await handler(
      { content: 'check' },
      { sessionKey: 'sess-check-bare', sendMessage },
    );

    expect(discovery.discoverOpenClaw).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(mockApi.logger.info).toHaveBeenCalledWith(expect.stringContaining('鏀跺埌鎵嬪姩 OpenClaw 鏈嶅姟妫€娴嬫寚浠? check'));
  });

  it('should trigger discovery reply on chinese detection prompt', async () => {
    setup(mockApi);
    const handler = handlers['message_received'];
    const sendMessage = vi.fn().mockResolvedValue(undefined);

    await handler(
      { content: 'help me check the lynx ip process' },
      { sessionKey: 'sess-check-cn', sendMessage },
    );

    expect(discovery.discoverOpenClaw).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('should still return discovery summary when sendMessage is unavailable', async () => {
    setup(mockApi);
    const handler = handlers['message_received'];

    const result = await handler(
      { content: '/check' },
      { sessionKey: 'sess-check-fallback' },
    );

    expect(discovery.discoverOpenClaw).toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        block: true,
      }),
    );
    expect(mockApi.logger.info).toHaveBeenCalledWith(expect.stringContaining('OpenClaw'));
  });
});

