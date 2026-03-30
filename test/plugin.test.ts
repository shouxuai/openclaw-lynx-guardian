
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import setup from '../index.ts';
import * as utils from '../src/utils.js';
import * as api from '../src/api.js';
import * as discovery from '../src/openclaw-discovery.js';
import * as runtimeConfig from '../src/discovery-runtime-config.js';
import * as securityAuditRunner from '../src/security-audit-runner.js';
import * as skillGuard from '../src/skill-guard.js';

vi.mock('../src/utils.js');
vi.mock('../src/api.js');
vi.mock('../src/openclaw-discovery.js', () => ({
  discoverOpenClaw: vi.fn(),
  formatDiscoverySummary: vi.fn((report: any) => [
    'OpenClaw 服务检测完成',
    `- 扫描目标数: ${report.scannedTargets}`,
    `- 展开主机数: ${report.expandedHosts}`,
    `- 命中结果数: ${report.hits.length}`,
    `- 已确认 OpenClaw 服务: ${report.hits.filter((hit: any) => hit.score >= 80).length} 个`,
    '已确认的 OpenClaw 服务列表:',
    ...report.hits.map((hit: any) => `- IP=${hit.host} 端口=${hit.port} 协议=${hit.scheme || 'http'} 评分=${hit.score} 状态=${hit.confidence}`),
  ].join('\n')),
}));
vi.mock('../src/discovery-runtime-config.js', () => ({
  loadDiscoveryRuntimeConfig: vi.fn(),
}));
vi.mock('../src/security-audit-runner.js', () => ({
  runSecurityAudit: vi.fn().mockResolvedValue(null),
  runMaliciousScriptScan: vi.fn().mockResolvedValue(null),
  formatAuditSummary: vi.fn().mockReturnValue('audit summary'),
}));
vi.mock('../src/skill-guard.js', async () => {
  const actual = await vi.importActual<typeof import('../src/skill-guard.js')>('../src/skill-guard.js');
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

  beforeEach(() => {
    vi.resetAllMocks();
    handlers = {};
    if (existsSync(pendingDiscoveryPath)) {
      rmSync(pendingDiscoveryPath, { force: true });
    }
    if (existsSync(consumedDiscoveryPath)) {
      rmSync(consumedDiscoveryPath, { force: true });
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
      result: { risk_level: 0, level_one: '其他', level_two: '其他', level_three: '其他' },
      message: 'ok',
    } as any);
    vi.mocked(runtimeConfig.loadDiscoveryRuntimeConfig).mockReturnValue({
      config: {
        enabled: true,
        runOnStartup: false,
        fullScan: false,
      },
      path: 'D:\\all-sunday\\openclaw-lynx\\openclaw-lynx-guardian\\lynx-discovery.config.json',
      created: false,
      warnings: [],
    });
    vi.mocked(discovery.formatDiscoverySummary).mockImplementation((report: any) => [
      'OpenClaw 服务检测完成',
      `- 扫描目标数: ${report.scannedTargets}`,
      `- 展开主机数: ${report.expandedHosts}`,
      `- 命中结果数: ${report.hits.length}`,
      `- 已确认 OpenClaw 服务: ${report.hits.filter((hit: any) => hit.score >= 80).length} 个`,
      '已确认的 OpenClaw 服务列表:',
      ...report.hits.map((hit: any) => `- IP=${hit.host} 端口=${hit.port} 协议=${hit.scheme || 'http'} 评分=${hit.score} 状态=${hit.confidence}`),
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
          confidence: '确认',
          confidenceDesc: 'OpenClaw 网关 [高置信度]',
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

  it('should attach all event handlers', () => {
    setup(mockApi);
    expect(mockApi.on).toHaveBeenCalledWith('message_received', expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith('before_agent_start', expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith('agent_end', expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith('gateway_start', expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith('before_message_write', expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith('before_tool_call', expect.any(Function));
  });

  it('should sync resources on gateway_start', async () => {
    setup(mockApi);
    const handler = handlers['gateway_start'];

    await handler({ port: 18789 }, {});

    expect(utils.ensureResources).toHaveBeenCalled();
    expect(mockApi.logger.info).toHaveBeenCalledWith(expect.stringContaining('Resources synced on gateway_start'));
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

  it('should redact leaked protected output on agent_end', async () => {
    setup(mockApi);
    const handler = handlers['agent_end'];
    const event = {
      messages: [
        { role: 'assistant', content: [{ type: 'text', text: 'TOOLS.md 内容如下: 工具定义与安全边界' }] },
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
      { message: { role: 'assistant', content: '你好，世界' } },
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
            { type: 'text', text: '你好，世界' },
          ],
        },
      },
      { sessionKey: 'sess-send-blocks' },
    );

    expect(result).toBeUndefined();
  });

  it('should append discovery report on before_message_write', async () => {
    setup(mockApi);
    const handler = handlers['before_message_write'];

    mkdirSync(join(openclawHome, '.openclaw'), { recursive: true });
    writeFileSync(pendingDiscoveryPath, '扫描结果: 127.0.0.1:18789', 'utf8');

    const result = await handler(
      { message: { role: 'assistant', content: '检测已完成' } },
      { sessionKey: 'sess-discovery-append' },
    );

    expect(result).toEqual({
      message: {
        role: 'assistant',
        content: expect.stringContaining('扫描结果: 127.0.0.1:18789'),
      },
    });
    expect((result as any).message.content).toContain('检测已完成');
    expect((result as any).message.content).toContain('📡 Lynx Guardian OpenClaw 服务检测报告');
    expect(existsSync(pendingDiscoveryPath)).toBe(false);
    expect(existsSync(consumedDiscoveryPath)).toBe(true);
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
        prependContext: expect.stringContaining('完整报告将由插件自动附加'),
      }),
    );
    expect(existsSync(pendingDiscoveryPath)).toBe(true);

    const report = readFileSync(pendingDiscoveryPath, 'utf8');
    expect(report).toContain('公网暴露检测');
    expect(report).toContain('恶意脚本扫描');
    expect(report).toContain('Skill 完整性校验');
    expect(report).toContain('服务发现 IP/端口');
    expect(report.lastIndexOf('服务发现 IP/端口')).toBeGreaterThan(report.lastIndexOf('Skill 完整性校验'));
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
    expect(mockApi.logger.info).toHaveBeenCalledWith(expect.stringContaining('收到手动 OpenClaw 服务检测指令'));
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
    expect(mockApi.logger.info).toHaveBeenCalledWith(expect.stringContaining('收到手动 OpenClaw 服务检测指令: check'));
  });

  it('should trigger discovery reply on chinese detection prompt', async () => {
    setup(mockApi);
    const handler = handlers['message_received'];
    const sendMessage = vi.fn().mockResolvedValue(undefined);

    await handler(
      { content: '帮我做一下ip检测龙虾进程' },
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
    expect(mockApi.logger.info).toHaveBeenCalledWith(expect.stringContaining('收到手动 OpenClaw 服务检测指令'));
  });
});
