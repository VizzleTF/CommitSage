import { Logger } from './logger';

/**
 * Pure parsing + per-leaf type validation for `.commitsage/config.json`. Split
 * out of `ConfigService` so the read-cache, the file watcher, and this
 * schema-validation concern each stand alone. The setting schema is passed in
 * (rather than imported) to keep this a leaf module with no cycle back to
 * `ConfigService`.
 */

/** Key names that address the prototype chain rather than a plain field. */
const UNSAFE_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

export function isPlainObject(value: unknown): value is Record<string, unknown> {
    return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value)
    );
}

/**
 * Parse raw JSON and drop anything that doesn't fit the schema: non-object
 * top level → {}, wrong-typed known keys and non-object known sections dropped
 * (with a warning) so users get feedback instead of a silent default. Keys not
 * present in `schema` pass through unchanged (forward-compat for settings added
 * in newer extension versions).
 */
export function parseAndValidateProjectConfig(
    raw: string,
    source: string,
    schema: Record<string, unknown>,
): Record<string, unknown> {
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainObject(parsed)) {
        Logger.warn(`Project config at ${source} is not an object — ignoring.`);
        return {};
    }
    return validateLevel(parsed, '', source, schema);
}

/** Validate one nesting level; `prefix` is the dotted path to it ('' or 'commit.refs.'). */
function validateLevel(
    level: Record<string, unknown>,
    prefix: string,
    source: string,
    schema: Record<string, unknown>,
): Record<string, unknown> {
    const validated: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(level)) {
        const fullKey = `${prefix}${key}`;
        // `__proto__` as a key would set the prototype of the object we hand
        // back instead of adding a field. No real setting is named this, so
        // dropping it costs nothing.
        if (UNSAFE_KEYS.has(key)) {
            Logger.warn(`Project config at ${source}: ignoring reserved key "${fullKey}".`);
            continue;
        }
        // A key copied from settings.json ("commit.commitFormat") is never read:
        // lookups walk nested objects.
        if (key.includes('.')) {
            Logger.warn(
                `Project config at ${source}: "${fullKey}" — use nested objects, e.g. {"commit": {"commitFormat": …}}; skipping.`,
            );
            continue;
        }
        // Own keys only: a top-level `toString` must not match Object.prototype.
        const expected = Object.hasOwn(schema, fullKey) ? schema[fullKey] : undefined;
        if (expected !== undefined) {
            if (typeof value === typeof expected) {
                validated[key] = value;
            } else {
                Logger.warn(
                    `Project config at ${source}: "${fullKey}" expected ${typeof expected}, got ${typeof value} — skipping.`,
                );
            }
        } else if (isPlainObject(value)) {
            validated[key] = validateLevel(value, `${fullKey}.`, source, schema);
        } else if (Object.keys(schema).some((k) => k.startsWith(`${fullKey}.`))) {
            // A known section holding a primitive (e.g. `commit: false`).
            Logger.warn(
                `Project config at ${source}: section "${fullKey}" is not an object, skipping.`,
            );
        } else {
            validated[key] = value;
        }
    }
    return validated;
}
