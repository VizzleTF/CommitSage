import { Logger } from './logger';
import { ProjectConfig } from '../models/types';

/**
 * Pure parsing + per-leaf type validation for `.commitsage/config.json`. Split
 * out of `ConfigService` so the read-cache, the file watcher, and this
 * schema-validation concern each stand alone. The setting schema is passed in
 * (rather than imported) to keep this a leaf module with no cycle back to
 * `ConfigService`.
 */

export function isPlainObject(value: unknown): value is Record<string, unknown> {
    return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value)
    );
}

/**
 * Parse raw JSON and drop anything that doesn't fit the schema: non-object
 * top level → {}, non-object sections skipped, and wrong-typed leaves dropped
 * (with a warning) so users get feedback instead of a silent default. Keys not
 * present in `schema` pass through unchanged (forward-compat for settings added
 * in newer extension versions).
 */
export function parseAndValidateProjectConfig(
    raw: string,
    source: string,
    schema: Record<string, unknown>,
): ProjectConfig {
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainObject(parsed)) {
        Logger.warn(`Project config at ${source} is not an object — ignoring.`);
        return {};
    }
    // Drop top-level keys that are not plain objects (e.g. `commit: false`),
    // since downstream code descends through them and would otherwise misread.
    const validated: Record<string, Record<string, unknown>> = {};
    for (const [section, value] of Object.entries(parsed)) {
        if (!isPlainObject(value)) {
            Logger.warn(
                `Project config at ${source}: section "${section}" is not an object, skipping.`,
            );
            continue;
        }
        const validatedSection: Record<string, unknown> = {};
        for (const [leaf, leafValue] of Object.entries(value)) {
            const fullKey = `${section}.${leaf}`;
            const expected = schema[fullKey];
            if (expected === undefined || typeof leafValue === typeof expected) {
                validatedSection[leaf] = leafValue;
            } else {
                Logger.warn(
                    `Project config at ${source}: "${fullKey}" expected ${typeof expected}, got ${typeof leafValue} — skipping.`,
                );
            }
        }
        validated[section] = validatedSection;
    }
    return validated;
}
