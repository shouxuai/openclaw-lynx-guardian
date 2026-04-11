
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
import * as recentActiveDelivery from '../src/runtime/recent-active-delivery.js';
import { deliverLynxReport } from '../src/runtime/lynx-message-delivery.js';
import {
  createLynxCheckRunIntent,
  getLynxCheckRunResultPath,
  getLynxCheckRunReportPath,
  readLatestPendingLynxCheckRunIntent,
  readLynxCheckRunIntent,
  readLynxCheckRunResult,
  writeLynxCheckRunResult,
} from '../src/runtime/lynx-check-run-store.js';
import { buildLynxCheckExecutionPrompt } from '../src/runtime/lynx-check-orchestrator.js';
import * as tokenOptimizerRunner from '../src/runtime/token-optimizer-runner.js';

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
vi.mock('../src/runtime/token-optimizer-runner.js', () => ({
  recommendContext: vi.fn().mockResolvedValue(null),
  routeModel: vi.fn().mockResolvedValue(null),
  checkBudget: vi.fn().mockResolvedValue(null),
  planHeartbeat: vi.fn().mockResolvedValue(null),
  formatContextRecommendation: vi.fn().mockReturnValue('context mock'),
  formatModelRouting: vi.fn().mockReturnValue('routing mock'),
  formatBudgetStatus: vi.fn().mockReturnValue('budget mock'),
  buildOptimizationHints: vi.fn().mockReturnValue(''),
  isTokenOptimizerAvailable: vi.fn().mockReturnValue(false),
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
  const openclawHome = join(process.cwd(), 'test-temp', 'plugin-home');
  const pendingDiscoveryPath = join(openclawHome, '.openclaw', '.lynx-pending-discovery.txt');
  const consumedDiscoveryPath = join(openclawHome, '.openclaw', '.lynx-pending-discovery.consumed');
  const pendingDiscoveryRequestPath = join(openclawHome, '.openclaw', '.lynx-pending-discovery.request.json');
  const hookProbeLogPath = join(openclawHome, '.openclaw', 'lynx', 'hook-probe.log');
  const scheduledCronStorePath = join(process.cwd(), 'test-temp', 'plugin-scheduled-lynx-check', 'jobs.json');
  const recentActiveDeliveryPath = join(openclawHome, '.openclaw', 'lynx', 'recent-active-delivery.json');
  const lynxCheckRunsPath = join(openclawHome, '.openclaw', 'lynx', 'check-runs');

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    vi.stubEnv('HOME', openclawHome);
    vi.stubEnv('USERPROFILE', openclawHome);
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
    if (existsSync(recentActiveDeliveryPath)) {
      rmSync(recentActiveDeliveryPath, { force: true });
    }
    if (existsSync(lynxCheckRunsPath)) {
      rmSync(lynxCheckRunsPath, { recursive: true, force: true });
    }
    recentActiveDelivery.resetRecentActiveDeliveryTargets(recentActiveDeliveryPath);
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
    vi.mocked(tokenOptimizerRunner.recommendContext).mockResolvedValue(null);
    vi.mocked(tokenOptimizerRunner.routeModel).mockResolvedValue(null);
    vi.mocked(tokenOptimizerRunner.checkBudget).mockResolvedValue(null);
    vi.mocked(tokenOptimizerRunner.planHeartbeat).mockResolvedValue(null);
    vi.mocked(tokenOptimizerRunner.buildOptimizationHints).mockReturnValue('');
    vi.mocked(tokenOptimizerRunner.isTokenOptimizerAvailable).mockReturnValue(false);
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
    expect(mockApi.on).toHaveBeenCalledWith('tool_result_persist', expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith('before_message_write', expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith('message_sending', expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith('before_tool_call', expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith('session_start', expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith('session_end', expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith('after_tool_call', expect.any(Function));
  });

  it('should expose policy config schema defaults', () => {
    const rawSchema = readFileSync(new URL('../openclaw.plugin.json', import.meta.url), 'utf8');
    const plugin = JSON.parse(rawSchema);
    const selfSafetyGuardSchema = plugin.configSchema?.properties?.selfSafetyGuard?.properties;
    const policySchema = selfSafetyGuardSchema?.policy;

    expect(policySchema).toBeDefined();
    expect(policySchema.properties.absoluteRejectScore.default).toBe(10);
    expect(policySchema.properties.confirmationPhrase.default).toBe('确认放行本次操作');
    expect(policySchema.properties.allowOneTimeOverrideLevels.items.enum).toEqual(['L2', 'L3', 'L4']);
    expect(policySchema.properties.moduleOverrides.properties.M3.properties.allowOneTimeOverride.default).toBe(true);
    expect(selfSafetyGuardSchema.resultGuard.default).toBe(true);
    expect(selfSafetyGuardSchema.outputEnforcementMode.default).toBe('block');
  });

  it('should declare the tested openclaw peer dependency floor', () => {
    const rawPackage = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    const pkg = JSON.parse(rawPackage);

    expect(pkg.peerDependencies.openclaw).toBe('>=2026.2.26');
  });

  it('should sync resources on gateway_start', async () => {
    setup(mockApi);
    const handler = handlers['gateway_start'];

    await handler({ port: 18789 }, {});

    expect(utils.ensureResources).toHaveBeenCalled();
    expect(mockApi.logger.error).not.toHaveBeenCalledWith(
      expect.stringContaining('Failed to sync resources on gateway_start'),
    );
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

  it('should allow trusted plugin-subsystem healthcheck reads during scheduled Lynx runs', async () => {
    setup(mockApi);
    const handler = handlers['before_tool_call'];

    const healthcheckSkillRead = await handler(
      {
        toolName: 'read',
        params: { path: '/opt/homebrew/lib/node_modules/openclaw/skills/healthcheck/SKILL.md' },
      },
      {
        sessionKey: 'sess-scheduled-lynx',
        subsystem: 'plugins',
      },
    );
    expect(healthcheckSkillRead).toBeUndefined();

    const dailyMemoryRead = await handler(
      {
        toolName: 'read',
        params: { path: '/Users/wuyu/.openclaw/workspace/memory/2026-04-08.md' },
      },
      {
        sessionKey: 'sess-scheduled-lynx',
        subsystem: 'plugins',
      },
    );
    expect(dailyMemoryRead).toBeUndefined();
  });

  it('should allow orchestrator skill protected reads only during managed /lynx-check runs', async () => {
    setup(mockApi);
    const beforeAgentStart = handlers['before_agent_start'];
    const toolHandler = handlers['before_tool_call'];

    await beforeAgentStart(
      { prompt: '[2026-04-11 09:00:00] /lynx-check' },
      {
        sessionKey: 'sess-managed-orchestrator-read',
        subsystem: 'plugins',
      },
    );

    const orchestratorSkillRead = await toolHandler(
      {
        toolName: 'read',
        params: { path: '/Users/wuyu/.openclaw/skills/lynx-guardian-check-orchestrator/SKILL.md' },
      },
      {
        sessionKey: 'sess-managed-orchestrator-read',
        subsystem: 'plugins',
      },
    );

    expect(orchestratorSkillRead).toBeUndefined();
  });

  it('should allow orchestrator skill protected reads during managed /lynx-check runs without subsystem marker', async () => {
    setup(mockApi);
    const beforeAgentStart = handlers['before_agent_start'];
    const toolHandler = handlers['before_tool_call'];

    await beforeAgentStart(
      { prompt: '[2026-04-11 09:00:00] /lynx-check' },
      {
        sessionKey: 'sess-managed-orchestrator-read-no-subsystem',
        subsystem: 'plugins',
      },
    );

    const orchestratorSkillRead = await toolHandler(
      {
        toolName: 'read',
        params: { path: 'skills/lynx-guardian-check-orchestrator/SKILL.md' },
      },
      {
        sessionKey: 'sess-managed-orchestrator-read-no-subsystem',
      },
    );

    expect(orchestratorSkillRead).toBeUndefined();
  });

  it('should not treat tool calls without sessionKey as managed runs even when another session has a pending run', async () => {
    setup(mockApi);
    const beforeAgentStart = handlers['before_agent_start'];
    const toolHandler = handlers['before_tool_call'];

    await beforeAgentStart(
      { prompt: '[2026-04-11 09:00:00] /lynx-check' },
      {
        sessionKey: 'sess-managed-existing-run',
        subsystem: 'plugins',
      },
    );

    const orchestratorReadWithoutSession = await toolHandler(
      {
        toolName: 'read',
        params: { path: '/Users/wuyu/.openclaw/skills/lynx-guardian-check-orchestrator/SKILL.md' },
      },
      {
        subsystem: 'plugins',
      },
    );

    expect(orchestratorReadWithoutSession).toEqual(
      expect.objectContaining({
        block: true,
      }),
    );
  });

  it('should orchestrator-flow still block unrelated protected reads during managed /lynx-check runs', async () => {
    setup(mockApi);
    const beforeAgentStart = handlers['before_agent_start'];
    const toolHandler = handlers['before_tool_call'];

    await beforeAgentStart(
      { prompt: '[2026-04-11 09:00:00] /lynx-check' },
      {
        sessionKey: 'sess-managed-non-orchestrator-read',
        subsystem: 'plugins',
      },
    );

    const unrelatedProtectedRead = await toolHandler(
      {
        toolName: 'read',
        params: { path: '/Users/wuyu/.openclaw/skills/not-allowed/SKILL.md' },
      },
      {
        sessionKey: 'sess-managed-non-orchestrator-read',
        subsystem: 'plugins',
      },
    );

    expect(unrelatedProtectedRead).toEqual(
      expect.objectContaining({
        block: true,
      }),
    );
  });

  it('should allow one-time override for local tool guard on the next identical retry only', async () => {
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
      block: true,
      blockReason: '[Lynx Guardian] blocked local tool',
      riskAssessment: {
        level: 'L4',
        score: 9,
        modules: ['M2:protected_file_access'],
        description: 'protected file tool attempt',
        action: 'deny',
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
    expect(confirm).toBeUndefined();

    const second = await toolHandler(event, { sessionKey: 'sess-local-tool-override' });
    expect(second).toBeUndefined();

    // Third call: workflow auth still active -> also allowed
    const third = await toolHandler(event, { sessionKey: 'sess-local-tool-override' });
    expect(third).toBeUndefined();



    expect(api.checkTool).not.toHaveBeenCalled();
    guardSpy.mockRestore();
  });

  it('should not open pending override flow for hard-lock tool modules', async () => {
    setup(mockApi);
    const toolHandler = handlers['before_tool_call'];
    const guardSpy = vi.spyOn(safetyGuard, 'guardToolCall').mockReturnValue({
      block: true,
      blockReason: '[Lynx Guardian] hard lock',
      riskAssessment: {
        level: 'L4',
        score: 9,
        modules: ['M2:plugin_integrity'],
        description: 'plugin integrity lock',
        action: 'deny',
      },
    });

    const event = {
      toolName: 'write',
      params: {
        file_path: 'C:\\Users\\alice\\.openclaw\\extensions\\openclaw-lynx-guardian\\src\\blacklist.ts',
      },
    };

    const first = await toolHandler(event, { sessionKey: 'sess-hard-lock' });
    expect(first).toEqual({
      block: true,
      blockReason: '[Lynx Guardian] hard lock',
    });
    expect((first as any).blockReason).not.toContain('纭鏀捐鏈鎿嶄綔');

    expect(api.checkTool).not.toHaveBeenCalled();
    guardSpy.mockRestore();
  });

  it('should allow blacklist-backed delete confirmation to open the workflow window', async () => {
    mockApi.config = {
      selfSafetyGuard: {
        policy: {
          confirmationPhrase: '纭鏀捐鏈鎿嶄綔',
          allowOneTimeOverrideLevels: ['L2', 'L3', 'L4'],
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
      level: 'warning',
      reason: 'VB FileSystem API (potentially destructive)',
    } as any);

    vi.mocked(utils.readRecentContext).mockReturnValue('User context');
    vi.mocked(api.checkTool).mockResolvedValue({
      code: 200,
      result: { is_safe: true, risk_level: 0, content: 'user requested deletion' },
      message: 'ok',
    } as any);

    const event = {
      toolName: 'exec',
      params: {
        command: '[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory("C:\\temp", "OnlyErrorDialogs", "SendToRecycleBin")',
      },
    };

    const first = await toolHandler(event, { sessionKey: 'sess-api-tool-override' });
    expect(first).toEqual({
      block: true,
      blockReason: expect.stringContaining('纭鏀捐鏈鎿嶄綔'),
    });

    const confirm = await messageHandler(
      { content: '纭鏀捐鏈鎿嶄綔' },
      { sessionKey: 'sess-api-tool-override' },
    );
    expect(confirm).toBeUndefined();

    const second = await toolHandler(event, { sessionKey: 'sess-api-tool-override' });
    expect(second).toBeUndefined();

    const third = await toolHandler(event, { sessionKey: 'sess-api-tool-override' });
    expect(third).toBeUndefined();

    expect(api.checkTool).toHaveBeenCalledTimes(1);
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

    expect(event.messages[0].content[0].text).toContain('输出已被安全防护替换');
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

  it('should keep before_message_write as decoration-only after managed /lynx-check orchestration injection', async () => {
    setup(mockApi);
    const beforeAgentStart = handlers['before_agent_start'];
    const beforeMessageWrite = handlers['before_message_write'];

    await beforeAgentStart(
      { prompt: '[2026-03-30 14:00:00] /lynx-check' },
      {
        sessionKey: 'sess-discovery-append',
        channelId: 'webchat',
        messageProvider: 'webchat',
        senderId: 'sender-before-write',
        sendMessage: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(existsSync(pendingDiscoveryPath)).toBe(false);
    expect(existsSync(pendingDiscoveryRequestPath)).toBe(false);

    const firstResult = await beforeMessageWrite(
      { message: { role: 'assistant', content: 'check completed' } },
      { sessionKey: 'sess-discovery-append' },
    );

    expect(firstResult).toBeUndefined();
    expect(existsSync(pendingDiscoveryPath)).toBe(false);
    expect(existsSync(consumedDiscoveryPath)).toBe(false);
    expect(existsSync(pendingDiscoveryRequestPath)).toBe(false);
    expect(mockApi.logger.info).not.toHaveBeenCalledWith(
      expect.stringContaining('Discovery report appended in before_message_write'),
    );

    const secondResult = await beforeMessageWrite(
      { message: { role: 'assistant', content: 'follow-up reply' } },
      { sessionKey: 'sess-discovery-append' },
    );

    expect(secondResult).toBeUndefined();
  });

  it('should rewrite unsafe tool results during tool_result_persist', async () => {
    setup(mockApi);
    const handler = handlers['tool_result_persist'];

    const result = await handler(
      {
        toolName: 'read',
        toolCallId: 'call-1',
        message: { role: 'tool', content: '/etc/passwd\nroot:x:0:0:root:/root:/bin/bash' },
        isSynthetic: false,
      },
      { sessionKey: 'sess-tool-result' },
    );

    expect(result).toEqual({
      message: expect.objectContaining({
        content: expect.stringContaining('tool result replaced by security guard'),
      }),
    });
  });

  it('should allow safe outbound content on message_sending', async () => {
    setup(mockApi);
    const handler = handlers['message_sending'];

    const result = await handler(
      { to: 'webchat', content: 'this is an outbound message' },
      { sessionKey: 'sess-message-sending' },
    );

    expect(result).toBeUndefined();
  });

  it('should cancel protected outbound content on message_sending', async () => {
    setup(mockApi);
    const handler = handlers['message_sending'];

    const result = await handler(
      { to: 'webchat', content: 'TOOLS.md content follows: internal tool boundaries' },
      { sessionKey: 'sess-message-sending-block' },
    );

    expect(result).toEqual({ cancel: true });
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

  it('should create a run intent and prepend execution-dispatch instructions for /lynx-check instead of persisting a composite report', async () => {
    setup(mockApi);
    const handler = handlers['before_agent_start'];

    const result = await handler(
      { prompt: '[2026-03-30 14:00:00] /lynx-check' },
      {
        sessionKey: 'sess-composite-check',
        channelId: 'webchat',
        messageProvider: 'webchat',
        senderId: 'sender-composite',
        sendMessage: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(mockApi.logger.error).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        prependContext: expect.stringContaining('Execution Dispatch Mode'),
      }),
    );
    expect((result as any).prependContext).toContain('lynx-guardian-check-orchestrator');
    expect((result as any).prependContext).toContain('SX-security-audit');
    expect((result as any).prependContext).toContain('SX-openclaw-discovery');
    expect(existsSync(pendingDiscoveryPath)).toBe(false);
    expect(existsSync(pendingDiscoveryRequestPath)).toBe(false);

    const runIntent = readLatestPendingLynxCheckRunIntent('sess-composite-check');
    expect(runIntent).toEqual(
      expect.objectContaining({
        source: 'manual',
        trigger: 'lynx_command',
        preferredTargetKind: 'current',
        sessionKey: 'sess-composite-check',
      }),
    );
    expect(runIntent?.routeHint).toEqual(
      expect.objectContaining({
        sessionKey: 'sess-composite-check',
        channelId: 'webchat',
        messageProvider: 'webchat',
      }),
    );
    expect(readLynxCheckRunResult(runIntent!.requestId)).toEqual(
      expect.objectContaining({
        requestId: runIntent!.requestId,
        status: 'not_started',
        sendSucceeded: false,
        reportPath: getLynxCheckRunReportPath(runIntent!.requestId),
      }),
    );
  });

  it('should normalize unsupported run result status into an explicit handled failure shape', () => {
    const intent = createLynxCheckRunIntent({
      requestId: 'run-result-partial-status',
      source: 'manual',
      trigger: 'lynx_command',
      preferredTargetKind: 'current',
    });
    const resultPath = getLynxCheckRunResultPath(intent.requestId);

    writeFileSync(resultPath, JSON.stringify({
      requestId: intent.requestId,
      status: 'partial',
      sendAttempted: true,
      sendSucceeded: false,
      transport: 'skill-partial',
      reportPath: `.openclaw/lynx/check-runs/${intent.requestId}.report.md`,
      completedAtMs: Date.now(),
    }, null, 2), 'utf8');

    expect(readLynxCheckRunResult(intent.requestId)).toEqual(
      expect.objectContaining({
        requestId: intent.requestId,
        status: 'failed',
        sendAttempted: true,
        sendSucceeded: false,
        transport: 'skill-partial',
      }),
    );
  });

  it('should preserve sendSucceeded when coercing unsupported run result statuses', () => {
    const intent = createLynxCheckRunIntent({
      requestId: 'run-result-partial-keep-send-succeeded',
      source: 'manual',
      trigger: 'lynx_command',
      preferredTargetKind: 'current',
    });
    const resultPath = getLynxCheckRunResultPath(intent.requestId);

    writeFileSync(resultPath, JSON.stringify({
      requestId: intent.requestId,
      status: 'partial',
      sendAttempted: true,
      sendSucceeded: true,
      transport: 'skill-partial',
      reportPath: `.openclaw/lynx/check-runs/${intent.requestId}.report.md`,
      completedAtMs: Date.now(),
    }, null, 2), 'utf8');

    expect(readLynxCheckRunResult(intent.requestId)).toEqual(
      expect.objectContaining({
        requestId: intent.requestId,
        status: 'failed',
        sendAttempted: true,
        sendSucceeded: true,
        transport: 'skill-partial',
      }),
    );
  });

  it('should drop unsupported relative traversal reportPath outside lynx check-runs root', () => {
    const intent = createLynxCheckRunIntent({
      requestId: 'run-result-traversal-report-path',
      source: 'manual',
      trigger: 'lynx_command',
      preferredTargetKind: 'current',
    });
    const resultPath = getLynxCheckRunResultPath(intent.requestId);

    writeFileSync(resultPath, JSON.stringify({
      requestId: intent.requestId,
      status: 'failed',
      sendAttempted: true,
      sendSucceeded: false,
      transport: 'skill-failed',
      reportPath: '../escaped.report.md',
      completedAtMs: Date.now(),
    }, null, 2), 'utf8');

    expect(readLynxCheckRunResult(intent.requestId)).toEqual(
      expect.objectContaining({
        requestId: intent.requestId,
        status: 'failed',
        reportPath: undefined,
      }),
    );
  });

  it('should build run result prompt paths as current-runtime readable absolute paths with only valid statuses', () => {
    const prompt = buildLynxCheckExecutionPrompt({
      requestId: 'run-result-prompt-paths',
      source: 'manual',
      preferredTargetKind: 'current',
      skillPath: 'skills/lynx-guardian-check-orchestrator/SKILL.md',
    });

    const expectedResultPath = getLynxCheckRunResultPath('run-result-prompt-paths');
    const expectedReportPath = getLynxCheckRunReportPath('run-result-prompt-paths');

    expect(prompt).toContain(`write it to ${expectedReportPath}.`);
    expect(prompt).toContain(`write ${expectedResultPath} with requestId, status, sendAttempted, sendSucceeded, transport, reportPath, errorMessage, and completedAtMs.`);
    expect(prompt).toContain('status must be one of: not_started, running, completed, failed.');
    expect(prompt).not.toContain('partial');
  });

  it('should fallback-send scheduled /lynx-check report to the most recent webchat session when skill delivery fails', async () => {
    setup(mockApi);
    const messageHandler = handlers['message_received'];
    const beforeAgentStart = handlers['before_agent_start'];
    const agentEnd = handlers['agent_end'];
    const recentWebchatSendMessage = vi.fn().mockResolvedValue(undefined);

    await messageHandler(
      { content: 'just keep this webchat session active' },
      {
        sessionKey: 'sess-webchat-recent',
        channelId: 'webchat',
        messageProvider: 'webchat',
        sendMessage: recentWebchatSendMessage,
      },
    );

    await beforeAgentStart(
      { prompt: '[2026-03-30 14:00:00] /lynx-check' },
      {
        sessionKey: 'sess-scheduled-recent-webchat',
        subsystem: 'plugins',
      },
    );

    const runIntent = readLatestPendingLynxCheckRunIntent('sess-scheduled-recent-webchat');
    const reportPath = getLynxCheckRunReportPath(runIntent!.requestId);
    writeFileSync(reportPath, '# scheduled report\n\nLynx Guardian OpenClaw', 'utf8');
    writeLynxCheckRunResult(runIntent!.requestId, {
      status: 'completed',
      sendAttempted: true,
      sendSucceeded: false,
      transport: 'skill-send-failed',
      reportPath,
      errorMessage: 'webchat send failed',
    });

    await agentEnd(
      {
        messages: [
          { role: 'assistant', content: [{ type: 'text', text: 'scheduled lynx run finished' }] },
        ],
      },
      {
        sessionKey: 'sess-scheduled-recent-webchat',
        subsystem: 'plugins',
      },
    );

    expect(recentWebchatSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'assistant',
        content: expect.stringContaining('scheduled report'),
      }),
    );
    expect(readLynxCheckRunIntent(runIntent!.requestId)?.status).toBe('completed');
    expect(mockApi.logger.info).toHaveBeenCalledWith(expect.stringContaining('sender-execution-plane'));
  });

  it('should fallback-send scheduled /lynx-check report to the most recent Feishu session when skill delivery fails', async () => {
    setup(mockApi);
    const messageHandler = handlers['message_received'];
    const beforeAgentStart = handlers['before_agent_start'];
    const agentEnd = handlers['agent_end'];
    const recentFeishuSendMessage = vi.fn().mockResolvedValue(undefined);

    await messageHandler(
      { content: 'keep this feishu session active' },
      {
        sessionKey: 'sess-feishu-recent',
        channelId: 'feishu',
        messageProvider: 'feishu',
        sendMessage: recentFeishuSendMessage,
      },
    );

    await beforeAgentStart(
      { prompt: '[2026-03-30 14:00:00] /lynx-check' },
      {
        sessionKey: 'sess-scheduled-recent-feishu',
        subsystem: 'plugins',
      },
    );

    const runIntent = readLatestPendingLynxCheckRunIntent('sess-scheduled-recent-feishu');
    const reportPath = getLynxCheckRunReportPath(runIntent!.requestId);
    writeFileSync(reportPath, '# scheduled report\n\nLynx Guardian OpenClaw', 'utf8');
    writeLynxCheckRunResult(runIntent!.requestId, {
      status: 'completed',
      sendAttempted: true,
      sendSucceeded: false,
      transport: 'skill-send-failed',
      reportPath,
      errorMessage: 'feishu send failed',
    });

    await agentEnd(
      {
        messages: [
          { role: 'assistant', content: [{ type: 'text', text: 'scheduled lynx run finished' }] },
        ],
      },
      {
        sessionKey: 'sess-scheduled-recent-feishu',
        subsystem: 'plugins',
      },
    );

    expect(recentFeishuSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'assistant',
        content: expect.stringContaining('scheduled report'),
      }),
    );
    expect(readLynxCheckRunIntent(runIntent!.requestId)?.status).toBe('completed');
  });

  it('should fallback-send manual /lynx-check report to the current session when skill delivery fails', async () => {
    setup(mockApi);
    const beforeAgentStart = handlers['before_agent_start'];
    const agentEnd = handlers['agent_end'];
    const sendMessage = vi.fn().mockResolvedValue(undefined);

    await beforeAgentStart(
      { prompt: '[2026-03-30 14:00:00] /lynx-check' },
      {
        sessionKey: 'sess-agent-end-current',
        channelId: 'webchat',
        messageProvider: 'webchat',
        senderId: 'sender-current',
        sendMessage,
      },
    );

    const runIntent = readLatestPendingLynxCheckRunIntent('sess-agent-end-current');
    const reportPath = getLynxCheckRunReportPath(runIntent!.requestId);
    writeFileSync(reportPath, '# manual report\n\nLynx Guardian OpenClaw', 'utf8');
    writeLynxCheckRunResult(runIntent!.requestId, {
      status: 'completed',
      sendAttempted: true,
      sendSucceeded: false,
      transport: 'skill-send-failed',
      reportPath,
      errorMessage: 'manual send failed',
    });

    await agentEnd(
      {
        messages: [
          { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
        ],
      },
      {
        sessionKey: 'sess-agent-end-current',
        sendMessage,
      },
    );

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'assistant',
        content: expect.stringContaining('manual report'),
      }),
    );
    expect(readLynxCheckRunIntent(runIntent!.requestId)?.status).toBe('completed');
  });

  it('should prefer resolved target + shared sender before legacy or same-session fallbacks', async () => {
    const fallbackSendMessage = vi.fn().mockResolvedValue(undefined);
    const resolveMessageTarget = vi.fn().mockResolvedValue({
      targetKey: 'webchat:webchat:sender',
      channelId: 'webchat',
      messageProvider: 'webchat',
    });
    const sharedSend = vi.fn().mockResolvedValue(undefined);
    const recentRouteSendMessage = vi.fn().mockResolvedValue(undefined);

    const result = await deliverLynxReport({
      log: mockApi.logger,
      ctx: {
        sessionKey: 'sess-scheduled-recent-adapter',
        sendMessage: fallbackSendMessage,
        resolveMessageTarget,
        sharedMessageSender: {
          send: sharedSend,
        },
      },
      tag: 'scheduled-/lynx-check-report',
      routeHint: {
        targetKey: 'recent-webchat',
        sessionKey: 'sess-scheduled-recent-adapter',
        channelId: 'webchat',
        messageProvider: 'webchat',
        updatedAtMs: 1712701000000,
      },
      routeHintSendMessage: recentRouteSendMessage,
      allowSameSessionFallback: true,
      message: {
        role: 'assistant',
        content: 'report',
      },
    });

    expect(result).toEqual({
      delivered: true,
      transport: 'shared-resolved-target',
    });
    expect(resolveMessageTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'webchat',
        messageProvider: 'webchat',
      }),
    );
    expect(sharedSend).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.objectContaining({
          channelId: 'webchat',
          messageProvider: 'webchat',
        }),
        message: expect.objectContaining({
          role: 'assistant',
          content: 'report',
        }),
      }),
    );
    expect(recentRouteSendMessage).not.toHaveBeenCalled();
    expect(fallbackSendMessage).not.toHaveBeenCalled();
  });

  it('should resolve current-context target when route hint is absent', async () => {
    const fallbackSendMessage = vi.fn().mockResolvedValue(undefined);
    const resolveMessageTarget = vi.fn().mockResolvedValue({
      targetKey: 'sess-current',
      sessionKey: 'sess-current',
      channelId: 'webchat',
      messageProvider: 'webchat',
    });
    const sharedSend = vi.fn().mockResolvedValue(undefined);

    const result = await deliverLynxReport({
      log: mockApi.logger,
      ctx: {
        sessionKey: 'sess-current',
        channelId: 'webchat',
        messageProvider: 'webchat',
        senderId: 'sender-a',
        sendMessage: fallbackSendMessage,
        resolveMessageTarget,
        sharedMessageSender: {
          send: sharedSend,
        },
      },
      tag: 'manual-/lynx-check-report',
      allowSameSessionFallback: true,
      message: {
        role: 'assistant',
        content: 'report',
      },
    });

    expect(result).toEqual({
      delivered: true,
      transport: 'shared-resolved-target',
    });
    expect(resolveMessageTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        targetKey: 'webchat:webchat:sender-a',
        sessionKey: 'sess-current',
        channelId: 'webchat',
        messageProvider: 'webchat',
        senderId: 'sender-a',
      }),
    );
    expect(sharedSend).toHaveBeenCalledTimes(1);
    expect(fallbackSendMessage).not.toHaveBeenCalled();
  });

  it('should fall back to legacy route sender when shared resolution returns null', async () => {
    const fallbackSendMessage = vi.fn().mockResolvedValue(undefined);
    const resolveMessageTarget = vi.fn().mockResolvedValue(null);
    const sharedSend = vi.fn().mockResolvedValue(undefined);
    const recentRouteSendMessage = vi.fn().mockResolvedValue(undefined);

    const result = await deliverLynxReport({
      log: mockApi.logger,
      ctx: {
        sessionKey: 'sess-current',
        sendMessage: fallbackSendMessage,
        resolveMessageTarget,
        sharedMessageSender: {
          send: sharedSend,
        },
      },
      tag: 'scheduled-/lynx-check-report',
      routeHint: {
        targetKey: 'recent-webchat',
        sessionKey: 'sess-current',
        channelId: 'webchat',
        messageProvider: 'webchat',
        updatedAtMs: 1712701000000,
      },
      routeHintSendMessage: recentRouteSendMessage,
      allowSameSessionFallback: true,
      message: {
        role: 'assistant',
        content: 'report',
      },
    });

    expect(result).toEqual({
      delivered: true,
      transport: 'legacy-route-hint-sendMessage',
    });
    expect(resolveMessageTarget).toHaveBeenCalledTimes(1);
    expect(sharedSend).not.toHaveBeenCalled();
    expect(recentRouteSendMessage).toHaveBeenCalledTimes(1);
    expect(fallbackSendMessage).not.toHaveBeenCalled();
  });

  it('should not use same-session fallback when route hint lacks sessionKey', async () => {
    const fallbackSendMessage = vi.fn().mockResolvedValue(undefined);

    const result = await deliverLynxReport({
      log: mockApi.logger,
      ctx: {
        sessionKey: 'sess-current',
        sendMessage: fallbackSendMessage,
      },
      tag: 'manual-/lynx-check-report',
      routeHint: {
        targetKey: 'recent-webchat',
        channelId: 'webchat',
        messageProvider: 'webchat',
        updatedAtMs: 1712701000000,
      },
      allowSameSessionFallback: true,
      message: {
        role: 'assistant',
        content: 'report',
      },
    });

    expect(result).toEqual({
      delivered: false,
      transport: 'none',
    });
    expect(fallbackSendMessage).not.toHaveBeenCalled();
  });

  it('should leave manual /lynx-check for before_agent_start orchestration instead of sending inline from message_received', async () => {
    setup(mockApi);
    const handler = handlers['message_received'];
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const resolveMessageTarget = vi.fn().mockResolvedValue({
      targetKey: 'webchat:webchat:sender-manual',
      sessionKey: 'sess-manual-lynx-check',
      channelId: 'webchat',
      messageProvider: 'webchat',
      senderId: 'sender-manual',
    });
    const sharedSend = vi.fn().mockResolvedValue(undefined);

    const result = await handler(
      { content: '/lynx-check' },
      {
        sessionKey: 'sess-manual-lynx-check',
        channelId: 'webchat',
        messageProvider: 'webchat',
        senderId: 'sender-manual',
        sendMessage,
        resolveMessageTarget,
        sharedMessageSender: {
          send: sharedSend,
        },
      },
    );

    expect(result).toBeUndefined();
    expect(discovery.discoverOpenClaw).not.toHaveBeenCalled();
    expect(resolveMessageTarget).not.toHaveBeenCalled();
    expect(sharedSend).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('should prepend execution-dispatch instructions and create a current-session run intent for manual /lynx-check', async () => {
    setup(mockApi);
    const handler = handlers['before_agent_start'];
    const sendMessage = vi.fn().mockResolvedValue(undefined);

    const result = await handler(
      { prompt: '[2026-03-30 14:00:00] /lynx-check' },
      {
        sessionKey: 'sess-manual-lynx-check-retry',
        channelId: 'webchat',
        messageProvider: 'webchat',
        senderId: 'sender-manual',
        sendMessage,
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        prependContext: expect.stringContaining('Execution Dispatch Mode'),
      }),
    );
    expect((result as any).prependContext).toContain('requestId');
    expect((result as any).prependContext).toContain('lynx-guardian-check-orchestrator');
    const runIntent = readLatestPendingLynxCheckRunIntent('sess-manual-lynx-check-retry');
    expect(runIntent).toEqual(
      expect.objectContaining({
        source: 'manual',
        preferredTargetKind: 'current',
        sessionKey: 'sess-manual-lynx-check-retry',
      }),
    );
    expect(readLynxCheckRunResult(runIntent!.requestId)).toEqual(
      expect.objectContaining({
        requestId: runIntent!.requestId,
        status: 'not_started',
      }),
    );
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('should not fallback-send when the managed /lynx-check skill already delivered the report', async () => {
    setup(mockApi);
    const beforeAgentStart = handlers['before_agent_start'];
    const agentEnd = handlers['agent_end'];
    const recentWebchatSendMessage = vi.fn().mockResolvedValue(undefined);

    await handlers['message_received'](
      { content: 'keep this webchat session active' },
      {
        sessionKey: 'sess-recent-sent',
        channelId: 'webchat',
        messageProvider: 'webchat',
        sendMessage: recentWebchatSendMessage,
      },
    );

    await beforeAgentStart(
      { prompt: '[2026-03-30 14:00:00] /lynx-check' },
      {
        sessionKey: 'sess-manual-lynx-check-fallback',
        subsystem: 'plugins',
      },
    );

    const runIntent = readLatestPendingLynxCheckRunIntent('sess-manual-lynx-check-fallback');
    const reportPath = getLynxCheckRunReportPath(runIntent!.requestId);
    writeFileSync(reportPath, '# delivered by skill', 'utf8');
    writeLynxCheckRunResult(runIntent!.requestId, {
      status: 'completed',
      sendAttempted: true,
      sendSucceeded: true,
      transport: 'skill-shared-sender',
      reportPath,
    });

    await agentEnd(
      {
        messages: [
          { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
        ],
      },
      {
        sessionKey: 'sess-manual-lynx-check-fallback',
        subsystem: 'plugins',
      },
    );

    expect(recentWebchatSendMessage).not.toHaveBeenCalled();
    expect(readLynxCheckRunIntent(runIntent!.requestId)?.status).toBe('completed');
  });

  it('agent_end should keep waiting through running and avoid premature fallback while result settles to completed', async () => {
    vi.useFakeTimers();
    try {
      setup(mockApi);
      const beforeAgentStart = handlers['before_agent_start'];
      const agentEnd = handlers['agent_end'];
      const sendMessage = vi.fn().mockResolvedValue(undefined);

      await beforeAgentStart(
        { prompt: '[2026-03-30 14:00:00] /lynx-check' },
        {
          sessionKey: 'sess-agent-end-settling',
          channelId: 'webchat',
          messageProvider: 'webchat',
          senderId: 'sender-settling',
          sendMessage,
        },
      );

      const runIntent = readLatestPendingLynxCheckRunIntent('sess-agent-end-settling');
      expect(runIntent).toBeTruthy();
      expect(readLynxCheckRunResult(runIntent!.requestId)?.status).toBe('not_started');

      setTimeout(() => {
        writeLynxCheckRunResult(runIntent!.requestId, {
          status: 'running',
          sendAttempted: false,
          sendSucceeded: false,
          transport: 'skill-running',
        });
      }, 10);

      setTimeout(() => {
        writeLynxCheckRunResult(runIntent!.requestId, {
          status: 'completed',
          sendAttempted: true,
          sendSucceeded: true,
          transport: 'skill-shared-sender',
        });
      }, 60);

      const agentEndPromise = agentEnd(
        {
          messages: [
            { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
          ],
        },
        {
          sessionKey: 'sess-agent-end-settling',
          sendMessage,
        },
      );

      await vi.advanceTimersByTimeAsync(300);
      await agentEndPromise;

      expect(sendMessage).not.toHaveBeenCalled();
      expect(readLynxCheckRunResult(runIntent!.requestId)?.status).toBe('completed');
      expect(readLynxCheckRunIntent(runIntent!.requestId)?.status).toBe('completed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('agent_end should fallback-send and complete the run when status remains running after bounded wait', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-04-11T00:00:00.000Z'));
      setup(mockApi);
      const agentEnd = handlers['agent_end'];
      const sendMessage = vi.fn().mockResolvedValue(undefined);
      const runIntent = createLynxCheckRunIntent({
        requestId: 'run-result-stays-running',
        source: 'manual',
        trigger: 'lynx_command',
        preferredTargetKind: 'current',
        sessionKey: 'sess-agent-end-running-timeout',
        createdAtMs: 1712793600000,
      });

      writeLynxCheckRunResult(runIntent.requestId, {
        status: 'running',
        sendAttempted: true,
        sendSucceeded: false,
        transport: 'skill-running',
      });

      const agentEndPromise = agentEnd(
        {
          messages: [
            { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
          ],
        },
        {
          sessionKey: 'sess-agent-end-running-timeout',
          sendMessage,
        },
      );

      await vi.advanceTimersByTimeAsync(300);
      await agentEndPromise;

      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(readLynxCheckRunIntent(runIntent.requestId)?.status).toBe('completed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('should bypass native /check and only claim /lynx-check plus keywords', async () => {
    setup(mockApi);
    const handler = handlers['message_received'];
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const resolveMessageTarget = vi.fn().mockResolvedValue({
      targetKey: 'webchat:webchat:sender-bypass',
      sessionKey: 'sess-lynx-check',
      channelId: 'webchat',
      messageProvider: 'webchat',
      senderId: 'sender-bypass',
    });
    const sharedSend = vi.fn().mockResolvedValue(undefined);

    const nativeCheck = await handler(
      { content: '/check' },
      {
        sessionKey: 'sess-native-check',
        channelId: 'webchat',
        messageProvider: 'webchat',
        senderId: 'sender-bypass',
        sendMessage,
        resolveMessageTarget,
        sharedMessageSender: {
          send: sharedSend,
        },
      },
    );
    expect(nativeCheck).toBeUndefined();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(sharedSend).not.toHaveBeenCalled();
    expect(discovery.discoverOpenClaw).not.toHaveBeenCalled();

    await handler(
      { content: '/lynx-check' },
      {
        sessionKey: 'sess-lynx-check',
        channelId: 'webchat',
        messageProvider: 'webchat',
        senderId: 'sender-bypass',
        sendMessage,
        resolveMessageTarget,
        sharedMessageSender: {
          send: sharedSend,
        },
      },
    );
    expect(sharedSend).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(discovery.discoverOpenClaw).not.toHaveBeenCalled();
  });

  it('should bypass native /check and avoid sending discovery messages', async () => {
    setup(mockApi);
    const handler = handlers['message_received'];
    const sendMessage = vi.fn().mockResolvedValue(undefined);

    const result = await handler(
      { content: '/check' },
      { sessionKey: 'sess-check', sendMessage },
    );

    expect(result).toBeUndefined();
    expect(discovery.discoverOpenClaw).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('should bypass bare check command', async () => {
    setup(mockApi);
    const handler = handlers['message_received'];
    const sendMessage = vi.fn().mockResolvedValue(undefined);

    const result = await handler(
      { content: 'check' },
      { sessionKey: 'sess-check-bare', sendMessage },
    );

    expect(result).toBeUndefined();
    expect(discovery.discoverOpenClaw).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('should not capture arbitrary slash command after colon-prefix normalization', async () => {
    setup(mockApi);
    const handler = handlers['message_received'];
    const sendMessage = vi.fn().mockResolvedValue(undefined);

    const result = await handler(
      { content: '/foo: check lynx ip process' },
      { sessionKey: 'sess-arbitrary-slash', sendMessage },
    );

    expect(result).toBeUndefined();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(discovery.discoverOpenClaw).not.toHaveBeenCalled();
  });

  it('should capture colon-separated natural language lynx request', async () => {
    setup(mockApi);
    const handler = handlers['message_received'];
    const sendMessage = vi.fn().mockResolvedValue(undefined);

    const result = await handler(
      { content: 'please check: lynx gateway ip' },
      { sessionKey: 'sess-natural-colon', sendMessage },
    );

    expect(discovery.discoverOpenClaw).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(result).toBeUndefined();
  });

  it('should not capture unrelated recheck shipping phrase', async () => {
    setup(mockApi);
    const handler = handlers['message_received'];
    const sendMessage = vi.fn().mockResolvedValue(undefined);

    const result = await handler(
      { content: 'recheck lynx shipping process' },
      { sessionKey: 'sess-recheck-shipping', sendMessage },
    );

    expect(result).toBeUndefined();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(discovery.discoverOpenClaw).not.toHaveBeenCalled();
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

  it('should bypass /check when sendMessage is unavailable', async () => {
    setup(mockApi);
    const handler = handlers['message_received'];

    const result = await handler(
      { content: '/check' },
      { sessionKey: 'sess-check-fallback' },
    );

    expect(result).toBeUndefined();
    expect(discovery.discoverOpenClaw).not.toHaveBeenCalled();
  });
});

