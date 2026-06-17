import * as vscode from 'vscode';
import { ApiKeyManager } from '../services/apiKeyManager';
import { Logger } from '../utils/logger';
import { toError } from '../utils/errorUtils';

/**
 * Per-provider command IDs and the friendly display name used in success/error
 * notifications. Order matches the order they appear in the Command Palette.
 * Adding a new provider here is the only change needed to expose its
 * set/remove commands — `registerSetApiKeyCommands` iterates over this list.
 */
interface ProviderCommandSpec {
    provider: string;
    label: string;
    setCommand: string;
    removeCommand: string;
}

const PROVIDER_COMMAND_SPECS: readonly ProviderCommandSpec[] = [
    { provider: 'gemini',     label: 'Gemini',     setCommand: 'commitsage.setApiKey',              removeCommand: 'commitsage.removeApiKey' },
    { provider: 'openai',     label: 'OpenAI',     setCommand: 'commitsage.setOpenAIApiKey',        removeCommand: 'commitsage.removeOpenAIApiKey' },
    { provider: 'codestral',  label: 'Codestral',  setCommand: 'commitsage.setCodestralApiKey',     removeCommand: 'commitsage.removeCodestralApiKey' },
    { provider: 'ollama',     label: 'Ollama auth token', setCommand: 'commitsage.setOllamaAuthToken', removeCommand: 'commitsage.removeOllamaAuthToken' },
    { provider: 'openrouter', label: 'OpenRouter', setCommand: 'commitsage.setOpenRouterApiKey',    removeCommand: 'commitsage.removeOpenRouterApiKey' },
    { provider: 'groq',       label: 'Groq',       setCommand: 'commitsage.setGroqApiKey',          removeCommand: 'commitsage.removeGroqApiKey' },
    { provider: 'anthropic',  label: 'Anthropic',  setCommand: 'commitsage.setAnthropicApiKey',     removeCommand: 'commitsage.removeAnthropicApiKey' },
    { provider: 'deepseek',   label: 'DeepSeek',   setCommand: 'commitsage.setDeepSeekApiKey',      removeCommand: 'commitsage.removeDeepSeekApiKey' },
    { provider: 'xai',        label: 'xAI',        setCommand: 'commitsage.setXaiApiKey',           removeCommand: 'commitsage.removeXaiApiKey' },
    { provider: 'custom',     label: 'Custom',     setCommand: 'commitsage.setCustomApiKey',        removeCommand: 'commitsage.removeCustomApiKey' },
];

export function registerSetApiKeyCommands(_context: vscode.ExtensionContext): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [];

    for (const spec of PROVIDER_COMMAND_SPECS) {
        disposables.push(
            vscode.commands.registerCommand(spec.setCommand, () =>
                ApiKeyManager.promptForKey(spec.provider),
            ),
            vscode.commands.registerCommand(spec.removeCommand, async () => {
                try {
                    await ApiKeyManager.removeKey(spec.provider);
                    await Logger.showInfo(
                        vscode.l10n.t('{0} API key has been removed', spec.label),
                    );
                } catch (error) {
                    Logger.error(`Error removing ${spec.label} API key:`, toError(error));
                    await Logger.showError(
                        vscode.l10n.t('Failed to remove API key: {0}', toError(error).message),
                    );
                }
            }),
        );
    }

    return disposables;
}
