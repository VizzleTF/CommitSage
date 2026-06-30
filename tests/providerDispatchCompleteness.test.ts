import { describe, it, expect } from 'vitest';
import { PROVIDERS } from '../src/services/providerCatalog';
import { supportsProvider } from '../src/services/aiServiceFactory';

// Drift guard (originally F2): adding a provider to PROVIDER_CATALOG without
// wiring a generation path — a dedicated non-compat service or a COMPAT_SPECS
// row — would throw only at generation time, in front of the user. This keeps
// the dispatch tables in lockstep with the catalog at test time instead.
describe('AIServiceFactory dispatch completeness', () => {
    it.each([...PROVIDERS])('every catalog provider %s resolves to a generation path', (provider) => {
        expect(supportsProvider(provider)).toBe(true);
    });
});
