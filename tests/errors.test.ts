import { describe, it, expect } from 'vitest';
import {
    GitExtensionNotFoundError,
    NoRepositoriesFoundError,
    NoChangesDetectedError,
    NoRepositorySelectedError,
    AiServiceError,
    ConfigurationError,
    UserCancelledError,
    ApiKeyInvalidError,
} from '../src/models/errors';

describe('model errors', () => {
    it('GitExtensionNotFoundError', () => {
        const e = new GitExtensionNotFoundError();
        expect(e).toBeInstanceOf(Error);
        expect(e.name).toBe('GitExtensionNotFoundError');
        expect(e.message).toContain('Git extension not found');
    });

    it('NoRepositoriesFoundError', () => {
        const e = new NoRepositoriesFoundError();
        expect(e.name).toBe('NoRepositoriesFoundError');
        expect(e.message).toContain('No Git repositories');
    });

    it('NoChangesDetectedError default message', () => {
        const e = new NoChangesDetectedError();
        expect(e.name).toBe('NoChangesDetectedError');
        expect(e.message).toBe('No changes detected.');
    });

    it('NoChangesDetectedError custom message', () => {
        const e = new NoChangesDetectedError('nothing here');
        expect(e.message).toBe('nothing here');
    });

    it('NoRepositorySelectedError', () => {
        const e = new NoRepositorySelectedError();
        expect(e.name).toBe('NoRepositorySelectedError');
        expect(e.message).toContain('No repository selected');
    });

    it('AiServiceError wraps message', () => {
        const e = new AiServiceError('boom');
        expect(e.name).toBe('AiServiceError');
        expect(e.message).toBe('AI service error: boom');
    });

    it('ConfigurationError wraps message', () => {
        const e = new ConfigurationError('bad');
        expect(e.name).toBe('ConfigurationError');
        expect(e.message).toBe('Configuration error: bad');
    });

    it('UserCancelledError default message', () => {
        const e = new UserCancelledError();
        expect(e.name).toBe('UserCancelledError');
        expect(e.message).toBe('Operation cancelled by user');
    });

    it('UserCancelledError custom message', () => {
        const e = new UserCancelledError('stopped');
        expect(e.message).toBe('stopped');
    });

    it('ApiKeyInvalidError includes provider', () => {
        const e = new ApiKeyInvalidError('OpenAI');
        expect(e.name).toBe('ApiKeyInvalidError');
        expect(e.message).toBe('Invalid or expired API key for OpenAI');
    });
});
