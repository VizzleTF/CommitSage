import axios from 'axios';
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

type ApiHeaders = Record<string, string>;

export class CustomEndpointService {
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

            const response = await axios.post<CustomApiResponse>(endpoint, payload, { headers });

            void Logger.log('Custom endpoint response received successfully');
            progress.report({ message: 'Commit message generated successfully', increment: 100 });

            const message = this.extractCommitMessage(response.data);
            return { message, model };
        } catch (error) {
            void Logger.error('Error generating commit message with custom endpoint:', error as Error);
            throw new Error(`Failed to generate commit message: ${(error as Error).message}`);
        }
    }

    private static extractCommitMessage(response: CustomApiResponse): string {
        if (!response.choices?.[0]?.message?.content) {
            throw new Error('Unexpected response format from custom endpoint');
        }

        return response.choices[0].message.content.trim();
    }
}