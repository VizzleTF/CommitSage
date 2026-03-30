# Adding a New AI Provider to CommitSage

Currently supported: `gemini`, `openai`, `codestral`, `ollama`.

Adding a new provider requires changes in **7 areas**. The examples below use `anthropic`.

---

## 1. `src/services/anthropicService.ts` — provider service

Create a new service file. Use an existing service as a reference (e.g., `openaiService.ts` for HTTP-based APIs).

Your service must implement the `IAIService` interface from `src/models/types.ts`:

```typescript
import { CommitMessage, ProgressReporter } from '../models/types';
import { BaseAIService } from './baseAIService';
import { ConfigService } from '../utils/configService';

export class AnthropicService {
    static async generateCommitMessage(
        prompt: string,
        progress: ProgressReporter,
        attempt: number = 0
    ): Promise<CommitMessage> {
        // 1. Get config values (model, API key, etc.)
        // 2. Make API request
        // 3. Use BaseAIService.extractAndValidateMessage() to validate response
        // 4. Use BaseAIService.handleHttpError() for error handling
        // 5. Return { message, model }
    }
}
```

Key patterns to follow:
- Use `BaseAIService.handleHttpError()` for consistent HTTP error handling
- Use `BaseAIService.extractAndValidateMessage()` to validate AI responses
- Report progress via `progress.report()`
- Support retry logic via the `attempt` parameter
- Respect `ConfigService.getApiRequestTimeout()` for request timeouts

## 2. `src/services/aiServiceFactory.ts` — register the provider

Import the service and add it to the factory:

```typescript
import { AnthropicService } from './anthropicService';

export enum AIServiceType {
    // ...existing types...
    ANTHROPIC = 'anthropic'
}

export class AIServiceFactory {
    private static readonly services: Record<AIServiceType, AIServiceClass> = {
        // ...existing services...
        [AIServiceType.ANTHROPIC]: AnthropicService
    };
}
```

## 3. `src/models/types.ts` — update `ProjectConfig`

Add the provider to the `type` union and add provider-specific config:

```typescript
export interface ProjectConfig {
    provider?: {
        type?: 'gemini' | 'codestral' | 'openai' | 'ollama' | 'anthropic';
    };
    // ...existing providers...
    anthropic?: {
        model?: string;
    };
}
```

## 4. `src/utils/configService.ts` — configuration methods

Add getter methods for the new provider's settings:

```typescript
static getAnthropicModel(): string {
    return this.getConfig<string>('anthropic', 'model', 'claude-sonnet-4-6');
}
```

Also add the provider to the validation list in `getProvider()`:

```typescript
if (!['gemini', 'openai', 'codestral', 'ollama', 'anthropic'].includes(provider)) {
```

## 5. `src/commands/` — API key commands

Add commands for setting and removing the API key:

- Create or extend files in `src/commands/setApiKeys.ts`
- Register new commands in `src/commands/index.ts`

## 6. `package.json` — VS Code extension manifest

Add in three places:

**a) Provider enum:**
```json
"commitSage.provider.type": {
    "enum": ["gemini", "openai", "codestral", "ollama", "anthropic"]
}
```

**b) Provider settings section:**
```json
"commitSage.anthropic.model": {
    "type": "string",
    "default": "claude-sonnet-4-6",
    "description": "Anthropic model to use"
}
```

**c) Commands** (for API key management):
```json
{
    "command": "commitsage.setAnthropicApiKey",
    "title": "Commit Sage: Set Anthropic API Key"
},
{
    "command": "commitsage.removeAnthropicApiKey",
    "title": "Commit Sage: Remove Anthropic API Key"
}
```

## 7. `README.md` — update documentation

Add the new provider to:
- The provider list at the top
- AI Provider Settings section
- Requirements section (if the provider has specific requirements)

---

## Verification

After making all changes:

1. `npm run compile` — ensure no TypeScript errors.
2. Open VS Code Settings → CommitSage → confirm the new provider appears in the dropdown.
3. Set the API key via Command Palette.
4. Select the new provider and generate a commit message.
5. Test error handling: use an invalid API key and verify the error message is clear.
