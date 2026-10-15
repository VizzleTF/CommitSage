// One-shot init payload the host embeds in the page (#init-data). Parsed once
// at module load; everything downstream reads these exported constants.

import type { InitData } from './protocol';

const initEl = document.getElementById('init-data');
if (!initEl?.textContent) {
    throw new Error('init-data missing');
}

export const init: InitData = JSON.parse(initEl.textContent);
export const L = init.l10n;

/** Providers with no live model endpoint. Sourced from the provider registry. */
export const NO_REFRESH_PROVIDERS = new Set(init.noRefreshProviders);
