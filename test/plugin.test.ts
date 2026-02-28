
import { describe, it, expect, vi, beforeEach } from 'vitest';
import setup from '../index.js';
import * as utils from '../src/utils.js';
import * as api from '../src/api.js';

vi.mock('../src/utils.js');
vi.mock('../src/api.js');

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
      },
      on: vi.fn((event, handler) => {
        handlers[event] = handler;
      }),
    };

    vi.mocked(utils.ensureUserRegistered).mockReturnValue('TEST_ID');
    vi.mocked(api.registerUser).mockResolvedValue({ code: 200, id: 'TEST_ID', message: 'OK' });
    vi.mocked(api.pushRecord).mockResolvedValue({ code: 200, message: 'OK' });
  });

  it('should register user on startup', () => {
    setup(mockApi);
    expect(utils.ensureUserRegistered).toHaveBeenCalled();
    expect(api.registerUser).toHaveBeenCalledWith('TEST_ID');
  });

  it('should attach event handlers', () => {
    setup(mockApi);
    expect(mockApi.on).toHaveBeenCalledWith('before_agent_start', expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith('llm_output', expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith('before_tool_call', expect.any(Function));
  });

  it('should inject warning on risky input', async () => {
    setup(mockApi);
    const handler = handlers['before_agent_start'];
    
    vi.mocked(api.checkContent).mockResolvedValue({
        code: 200,
        result: { is_safe: false, risk_level: 1, level_one: 'pol', level_two: '', level_three: '' },
        message: 'risk'
    });

    const event = { input: 'risky input' };
    await handler(event, {});
    
    expect(api.checkContent).toHaveBeenCalledWith('TEST_ID', 'risky input', 1);
    expect(event.input).toContain('请注意，内容包含低危风险');
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

    // rm -rf / is in blacklist (critical)
    const result = await handler({ toolName: 'exec', params: { command: 'rm -rf /' } }, { sessionKey: 'sess1' });
    
    // Should have called pushRecord
    expect(api.pushRecord).toHaveBeenCalledWith(
      'TEST_ID',
      expect.stringContaining('rm -rf /'),
      3 // critical -> 3
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
});
