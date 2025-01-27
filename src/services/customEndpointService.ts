import axios, { AxiosError } from 'axios';
import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import { ConfigService } from '../utils/configService';
import { ProgressReporter, CommitMessage } from '../models/types';

interface CustomApiResponse {
    choices: Array<{
        message: {
            content: string;
        };
    }>;
}

interface ModelsResponse {
    data: Array<{
        id: string;
        owned_by?: string;
    }>;
}

type ApiHeaders = Record<string, string>;

export class CustomEndpointService {
    private static readonly CHAT_COMPLETIONS_PATH = '/chat/completions';
    private static readonly MODELS_PATH = '/models';

    static async generateCommitMessage(
        prompt: string,
        progress: ProgressReporter
    ): Promise<CommitMessage> {
        const apiKey = await ConfigService.getCustomApiKey();
        const endpoint = ConfigService.getCustomEndpoint();
        const model = ConfigService.getCustomModel();

        const payload = {
            model: model,
            messages: [{ role: "user", content: prompt }]
        };

        const headers: ApiHeaders = {
            'content-type': 'application/json',
            'authorization': `Bearer ${apiKey}`
        };

        try {
            void Logger.log('Sending request to custom endpoint');
            progress.report({ message: 'Generating commit message...', increment: 50 });

            const response = await axios.post<CustomApiResponse>(
                `${endpoint}${this.CHAT_COMPLETIONS_PATH}`,
                payload,
                { headers }
            );

            void Logger.log('Custom endpoint response received successfully');
            progress.report({ message: 'Commit message generated successfully', increment: 100 });

            const message = this.extractCommitMessage(response.data);
            return { message, model };
        } catch (error) {
            const axiosError = error as AxiosError;
            const errorMessage = axiosError.response?.status === 405
                ? `Failed to generate commit message: endpoint "${endpoint}" returned Method Not Allowed (405). Please verify the endpoint URL.`
                : `Failed to generate commit message: ${(error as Error).message}`;

            void Logger.error('Error generating commit message with custom endpoint:', error as Error);
            throw new Error(errorMessage);
        }
    }

    static async fetchAvailableModels(baseUrl: string, apiKey: string): Promise<string[]> {
        try {
            const headers: ApiHeaders = {
                'content-type': 'application/json',
                'authorization': `Bearer ${apiKey}`
            };

            const response = await axios.get<ModelsResponse>(
                `${baseUrl}${this.MODELS_PATH}`,
                { headers }
            );

            if (!response.data?.data) {
                return [];
            }

            const models = response.data.data.map(model => model.id);
            if (models.length > 0) {
                void Logger.log(`Successfully fetched ${models.length} models`);
            }
            return models;
        } catch (error) {
            return [];
        }
    }

    private static extractCommitMessage(response: CustomApiResponse): string {
        if (!response.choices?.[0]?.message?.content) {
            throw new Error('Unexpected response format from custom endpoint');
        }

        return response.choices[0].message.content.trim();
    }
}