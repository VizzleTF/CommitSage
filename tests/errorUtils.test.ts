import { describe, it, expect } from 'vitest';
import { redactDiffSecrets, sanitizeErrorForTelemetry, toError } from '../src/utils/errorUtils';

describe('toError', () => {
    it('passes Error instances through', () => {
        const e = new Error('boom');
        expect(toError(e)).toBe(e);
    });

    it('wraps non-Error values', () => {
        const e = toError('boom');
        expect(e).toBeInstanceOf(Error);
        expect(e.message).toBe('boom');
    });
});

describe('sanitizeErrorForTelemetry', () => {
    it('redacts file paths', () => {
        const e = new Error('failed at /Users/jane/proj/src/foo.ts:23');
        expect(sanitizeErrorForTelemetry(e).error).toContain('<path>');
        expect(sanitizeErrorForTelemetry(e).error).not.toContain('/Users/jane');
    });

    it('redacts ?key= URL secrets', () => {
        const e = new Error(
            'GET https://generativelanguage.googleapis.com/v1/models?key=AIzaSyABCDEFG failed'
        );
        const out = sanitizeErrorForTelemetry(e).error;
        expect(out).toContain('key=<redacted>');
        expect(out).not.toContain('AIzaSyABCDEFG');
    });

    it('redacts &key= URL secrets', () => {
        const e = new Error('foo?bar=1&key=AIzaSyABCDEFG&baz=2');
        const out = sanitizeErrorForTelemetry(e).error;
        expect(out).toContain('key=<redacted>');
        expect(out).not.toContain('AIzaSyABCDEFG');
    });

    it('redacts Bearer tokens (header form)', () => {
        const e = new Error('Authorization: Bearer sk-abc123XYZ failed');
        const out = sanitizeErrorForTelemetry(e).error;
        // Either Authorization or Bearer redaction may match first; key
        // requirement is that the secret itself never appears.
        expect(out).not.toContain('sk-abc123XYZ');
        expect(out).toContain('<redacted>');
    });

    it('redacts standalone Bearer token', () => {
        const e = new Error('got Bearer abc.def-ghi back');
        const out = sanitizeErrorForTelemetry(e).error;
        expect(out).toContain('Bearer <redacted>');
        expect(out).not.toContain('abc.def-ghi');
    });

    it('redacts x-goog-api-key header strings', () => {
        const e = new Error('x-goog-api-key: AIzaSyABCDEFG');
        const out = sanitizeErrorForTelemetry(e).error;
        expect(out).toContain('x-goog-api-key: <redacted>');
        expect(out).not.toContain('AIzaSyABCDEFG');
    });

    it('takes errorType from error.name, which survives minification', () => {
        class Minified extends Error {
            constructor(message: string) {
                super(message);
                this.name = 'MyError';
            }
        }
        expect(sanitizeErrorForTelemetry(new Minified('x')).errorType).toBe('MyError');
    });
});

describe('redactApiSecrets on known token formats', () => {
    it('masks a GitHub token inside an error message', () => {
        const token = `ghp_${'a1B2'.repeat(9)}`;
        const out = sanitizeErrorForTelemetry(new Error(`push rejected for ${token}`)).error;
        expect(out).toBe('push rejected for <redacted>');
    });
});

describe('redactDiffSecrets', () => {
    // Built at runtime so this file holds no literal secret for scanners to flag.
    const tokens: Array<[string, string]> = [
        ['aws-access-token', `AKIA${'QWERTYUIOPASDFGH'}`],
        ['github-pat', `ghp_${'a1B2'.repeat(9)}`],
        ['github-app-token', `ghs_${'a1B2'.repeat(9)}`],
        ['github-fine-grained-pat', `github_pat_${'A1b2_'.repeat(16)}xy`],
        ['gitlab-pat', `glpat-${'x1Y2_'.repeat(4)}`],
        ['slack-bot-token', `xoxb-${'1234567890'}-${'1234567890'}-abcDEF`],
        ['stripe-access-token', `sk_${'live'}_${'a1'.repeat(12)}`],
        ['gcp-api-key', `AIza${'Sy'}${'A1b2C3d4E5'.repeat(3)}f6g`],
        ['anthropic-api-key', `sk-ant-api03-${'x1Y2'.repeat(24)}AA`],
        ['openai-api-key (project)', `sk-proj-${'a1B2c3'.repeat(10)}`],
        ['openai-api-key (legacy)', `sk-${'a1B2'.repeat(12)}`],
        ['jwt', `eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.${'dozjgNryP4J3jVmNHl0w5N_'.repeat(2)}`],
    ];

    it.each(tokens)('masks a %s and keeps the line prefix', (_id, secret) => {
        expect(redactDiffSecrets(`+client.use(${secret});`)).toBe('+client.use(<redacted>);');
        expect(redactDiffSecrets(`-client.use(${secret});`)).toBe('-client.use(<redacted>);');
    });

    it('keeps the diff structure: headers, hunk headers and line prefixes', () => {
        const diff = [
            'diff --git a/app.ts b/app.ts',
            '--- a/app.ts',
            '+++ b/app.ts',
            '@@ -1,2 +1,2 @@ const config = {',
            ` const keep = 1;`,
            `-const key = '${tokens[1][1]}';`,
            `+const key = process.env.KEY;`,
        ].join('\n');
        const out = redactDiffSecrets(diff);
        expect(out.split('\n')).toHaveLength(7);
        expect(out).toBe(diff.replace(tokens[1][1], '<redacted>'));
    });

    it('masks quoted values assigned to a secret-sounding name', () => {
        expect(redactDiffSecrets('+db_password = "s3cr3t-value"')).toBe('+db_password = "<redacted>"');
        expect(redactDiffSecrets('+  "apiKey": "abcd1234efgh",')).toBe('+  "apiKey": "<redacted>",');
        expect(redactDiffSecrets("+$client_secret => 'abcdefgh1'")).toBe("+$client_secret => '<redacted>'");
    });

    it.each([
        '+sortKey: "createdAtDesc"',
        '+tokenType: "refresh_token_kind"',
        '+const token = getToken();',
        '+password: string;',
        '+if (token === "abcdefghijk") {',
        '+label = "Enter your password"',
    ])('leaves ordinary code alone: %s', (line) => {
        expect(redactDiffSecrets(line)).toBe(line);
    });

    it('masks every body line of a multi-line private key, across a hunk header', () => {
        const diff = [
            '+-----BEGIN RSA PRIVATE KEY-----',
            '+MIIEowIBAAKCAQEAx1y2z3',
            '@@ -10,3 +10,3 @@',
            '+abc/def+ghi==',
            '+',
            '+-----END RSA PRIVATE KEY-----',
            '+after',
        ].join('\n');
        expect(redactDiffSecrets(diff).split('\n')).toEqual([
            '+-----BEGIN RSA PRIVATE KEY-----',
            '+<redacted>',
            '@@ -10,3 +10,3 @@',
            '+<redacted>',
            '+',
            '+-----END RSA PRIVATE KEY-----',
            '+after',
        ]);
    });

    it('masks a private key held in one JSON line', () => {
        const line = String.raw`+  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADAN\n-----END PRIVATE KEY-----\n",`;
        expect(redactDiffSecrets(line)).toBe(
            String.raw`+  "private_key": "-----BEGIN PRIVATE KEY-----<redacted>-----END PRIVATE KEY-----\n",`,
        );
    });

    it('stops masking at code after a quoted BEGIN marker and at the next file', () => {
        const diff = [
            "+if (pem.startsWith('-----BEGIN PRIVATE KEY-----')) {",
            '+  return parse(pem);',
            '+-----BEGIN PRIVATE KEY-----',
            'diff --git a/b.txt b/b.txt',
            '+plain',
        ].join('\n');
        expect(redactDiffSecrets(diff).split('\n')).toEqual([
            '+if (pem.startsWith(\'-----BEGIN PRIVATE KEY-----<redacted>',
            '+  return parse(pem);',
            '+-----BEGIN PRIVATE KEY-----',
            'diff --git a/b.txt b/b.txt',
            '+plain',
        ]);
    });

    it.each([
        ['an unterminated quoted value', `+token = "${'a'.repeat(200_000)}`],
        ['many BEGIN markers on one line', `+${'-----BEGIN PRIVATE KEY-----'.repeat(10_000)}`],
        ['a long JWT-like run', `+ey${'a'.repeat(200_000)}`],
        ['a long name before a keyword', `+${'a.'.repeat(100_000)}password = "x"`],
    ])('runs in linear time on %s', (_label, diff) => {
        const start = performance.now();
        redactDiffSecrets(diff);
        expect(performance.now() - start).toBeLessThan(1000);
    });
});
