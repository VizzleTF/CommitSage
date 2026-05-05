import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildGitEnv } from '../src/utils/gitEnv';

describe('buildGitEnv', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it('forwards PATH from the parent process', () => {
        process.env.PATH = '/usr/bin';
        expect(buildGitEnv().PATH).toBe('/usr/bin');
    });

    it('always sets GIT_TERMINAL_PROMPT=0 to disable interactive auth prompts', () => {
        expect(buildGitEnv().GIT_TERMINAL_PROMPT).toBe('0');
    });

    it('does not forward arbitrary parent-process secrets', () => {
        process.env.MY_SECRET_TOKEN = 'sekret';
        process.env.AMPLITUDE_API_KEY = 'amp-key';
        const env = buildGitEnv();
        expect(env.MY_SECRET_TOKEN).toBeUndefined();
        expect(env.AMPLITUDE_API_KEY).toBeUndefined();
    });

    it('forwards SSH_AUTH_SOCK so signed/SSH pushes still work', () => {
        process.env.SSH_AUTH_SOCK = '/tmp/ssh-agent.sock';
        expect(buildGitEnv().SSH_AUTH_SOCK).toBe('/tmp/ssh-agent.sock');
    });

    it('omits whitelisted vars when they are unset in the parent', () => {
        delete process.env.GIT_SSH_COMMAND;
        expect('GIT_SSH_COMMAND' in buildGitEnv()).toBe(false);
    });
});
