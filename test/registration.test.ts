
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureUserRegistered, generateUserId } from '../src/utils.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('fs');
vi.mock('os');

describe('User Registration (utils.ts)', () => {
  const mockHome = '/mock/home';
  
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(os.homedir).mockReturnValue(mockHome);
  });

  it('generateUserId should return a string with correct format', () => {
    const id = generateUserId();
    // Expect LYNX00 + 8 digits (YYYYMMDD) + 4 digits (random)
    expect(id).toMatch(/^LYNX00\d{8}\d{4}$/);
    expect(id.length).toBe(18);
  });

  it('ensureUserRegistered should return existing ID if file exists', () => {
    // Mock cache dir exists
    vi.mocked(fs.existsSync).mockReturnValue(true);
    // Mock read file with new format
    const existingId = 'LYNX00202602271234';
    vi.mocked(fs.readFileSync).mockReturnValue(existingId);
    // Mock stat for directory check in resolveSessionsDir
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);

    const id = ensureUserRegistered();
    expect(id).toBe(existingId);
    expect(fs.readFileSync).toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('ensureUserRegistered should generate and save new ID if file missing', () => {
    // Mock nothing exists
    vi.mocked(fs.existsSync).mockReturnValue(false);
    
    const id = ensureUserRegistered();
    
    expect(id).toMatch(/^LYNX00\d{12}$/);
    // Should create directory
    expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('.openclaw/lynx'), { recursive: true });
    // Should write file
    expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('user_id'),
        id,
        'utf-8'
    );
  });
});
