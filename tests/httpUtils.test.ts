import { describe, it, expect } from 'vitest';
import { HttpUtils } from '../src/utils/httpUtils';

describe('HttpUtils.stripTrailingSlashes', () => {
    it('removes a single trailing slash', () => {
        expect(HttpUtils.stripTrailingSlashes('https://api.test/')).toBe('https://api.test');
    });

    it('removes multiple trailing slashes', () => {
        expect(HttpUtils.stripTrailingSlashes('https://api.test///')).toBe('https://api.test');
    });

    it('leaves a slash-free string untouched', () => {
        expect(HttpUtils.stripTrailingSlashes('https://api.test/v1')).toBe('https://api.test/v1');
    });

    it('handles an empty string', () => {
        expect(HttpUtils.stripTrailingSlashes('')).toBe('');
    });

    it('does not strip interior slashes', () => {
        expect(HttpUtils.stripTrailingSlashes('a/b/c/')).toBe('a/b/c');
    });
});
