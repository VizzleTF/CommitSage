// One-shot init payload the host embeds in the page (#init-data). Parsed once
// at module load; everything downstream reads these exported constants.

import type { InitData } from './protocol';

const initEl = document.getElementById('init-data');
if (!initEl?.textContent) {
    throw new Error('init-data missing');
}

export const init: InitData = JSON.parse(initEl.textContent);
export const L = init.l10n;
export const KEYS = init.settingKeys;

/** Formats the project's commitlint parser can validate directly. Sourced from
 *  the host (formatRules.COMMITLINT_COMPATIBLE_FORMATS) — single source of truth. */
export const COMMITLINT_COMPAT_FORMATS = new Set(init.commitlintCompatFormats);

/** Providers with no live model endpoint. Sourced from the provider registry. */
export const NO_REFRESH_PROVIDERS = new Set(init.noRefreshProviders);
