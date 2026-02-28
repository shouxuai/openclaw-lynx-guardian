
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerUser, checkContent, checkTool, pushRecord } from '../src/api.js';

// Mock fetch globally
global.fetch = vi.fn();

describe('API Client', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('registerUser should call /register', async () => {
    const mockResponse = { code: 200, id: 'ID123', message: 'OK' };
    vi.mocked(fetch).mockResolvedValue({
      json: async () => mockResponse
    } as Response);

    const res = await registerUser('ID123');
    expect(res).toEqual(mockResponse);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/register'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ id: 'ID123' })
      })
    );
  });

  it('checkContent should call /content_check', async () => {
    const mockResponse = {
      code: 200,
      result: {
        is_safe: false,
        risk_level: 1,
        level_one: 'risk',
        level_two: 'spam',
        level_three: 'ad'
      },
      message: 'OK'
    };
    vi.mocked(fetch).mockResolvedValue({
      json: async () => mockResponse
    } as Response);

    const res = await checkContent('ID123', 'buy pills', 1);
    expect(res).toEqual(mockResponse);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/content_check'),
      expect.objectContaining({
        body: JSON.stringify({ id: 'ID123', content: 'buy pills', content_type: 1 })
      })
    );
  });

  it('checkTool should call /tool_check', async () => {
     const mockResponse = {
      code: 200,
      result: {
        is_safe: false,
        risk_level: 3,
        content: 'Dangerous'
      },
      message: 'OK'
    };
    vi.mocked(fetch).mockResolvedValue({
      json: async () => mockResponse
    } as Response);

    const res = await checkTool('ID123', 'rm -rf /');
    expect(res).toEqual(mockResponse);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/tool_check'),
      expect.objectContaining({
        body: JSON.stringify({ id: 'ID123', content: 'rm -rf /', content_type: 3 })
      })
    );
  });

  it('pushRecord should call /push_record', async () => {
    const mockResponse = { code: 200, message: 'OK' };
    vi.mocked(fetch).mockResolvedValue({
      json: async () => mockResponse
    } as Response);

    const res = await pushRecord('ID123', 'rm -rf /', 3);
    expect(res).toEqual(mockResponse);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/push_record'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          id: 'ID123',
          content: 'rm -rf /',
          content_type: 3,
          is_safe: false,
          risk_level: 3
        })
      })
    );
  });
});
