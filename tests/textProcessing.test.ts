import { describe, it, expect } from 'vitest';
import { removeThinkTags } from '../src/utils/textProcessing';

describe('removeThinkTags', () => {
    it('returns input unchanged when no think tags', () => {
        expect(removeThinkTags('feat: add login')).toBe('feat: add login');
    });

    it('strips a single think block', () => {
        const input = '<think>let me see…</think>fix: typo';
        expect(removeThinkTags(input)).toBe('fix: typo');
    });

    it('strips multiple think blocks', () => {
        const input = '<think>a</think>chore: x<think>b</think>';
        expect(removeThinkTags(input)).toBe('chore: x');
    });

    it('strips multi-line think block', () => {
        const input = `<think>
line1
line2
</think>fix: bug`;
        expect(removeThinkTags(input)).toBe('fix: bug');
    });

    it('trims surrounding whitespace', () => {
        expect(removeThinkTags('   feat: x\n\n')).toBe('feat: x');
    });

    it('returns empty string when entire content is in think tags', () => {
        expect(removeThinkTags('<think>only thinking</think>')).toBe('');
    });
});
