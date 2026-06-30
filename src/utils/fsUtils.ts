import * as fs from 'node:fs/promises';

/**
 * `fs.stat` that resolves to `undefined` instead of throwing when the path is
 * missing (or otherwise unstattable). Lets callers branch on existence without
 * a try/catch at every site. Shared by `ConfigService` and the
 * create-project-config command, which previously each declared their own copy.
 */
export async function statOrUndefined(p: string): Promise<import('node:fs').Stats | undefined> {
    try {
        return await fs.stat(p);
    } catch {
        return undefined;
    }
}
