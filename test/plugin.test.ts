
import { describe, it, expect, vi, beforeEach } from 'vitest';
import setup from '../index.js';
import * as utils from '../src/utils.js';
import * as api from '../src/api.js';
import * as discovery from '../src/openclaw-discovery.js';
import * as runtimeConfig from '../src/discovery-runtime-config.js';

vi.mock('../src/utils.js');
vi.mock('../src/api.js');
vi.mock('../src/openclaw-discovery.js', () => ({
  discoverOpenClaw: vi.fn(),
  formatDiscoverySummary: vi.fn().mockReturnValue('discovery summary'),
}));
vi.mock('../src/discovery-runtime-config.js', () => ({
  loadDiscoveryRuntimeConfig: vi.fn(),
}));
vi.mock('../src/security-audit-runner.js', () => ({
  runSecurityAudit: vi.fn().mockResolvedValue(null),
  runMaliciousScriptScan: vi.fn().mockResolvedValue(null),
  formatAuditSummary: vi.fn().mockReturnValue('audit summary'),
}));

describe('Plugin Setup', () => {
  let mockApi: any;
  let handlers: Record<string, Function> = {};

  beforeEach(() => {
    vi.resetAllMocks();
    handlers = {};
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
    vi.mocked(api.registerUser).mockResolvedValue({ code: 200, id: 'TEST_ID', message: 'OK' });
    vi.mocked(api.pushRecord).mockResolvedValue({ code: 200, message: 'OK' });
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
    expect(mockApi.on).toHaveBeenCalledWith('before_tool_call', expect.any(Function));
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
        content: expect.stringContaining('OpenClaw 服务检测已立即启动'),
      }),
    );
    expect(sendMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        role: 'assistant',
        content: expect.stringContaining('OpenClaw 服务检测结果'),
      }),
    );
    expect(result).toEqual({
      block: true,
      blockReason: expect.stringContaining('OpenClaw 服务检测请求'),
    });
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
    expect(sendMessage.mock.calls[1][0].content).toContain('127.0.0.1:18789');
  });
});
