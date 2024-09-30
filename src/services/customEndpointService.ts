import axios from 'axios';
import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import { ConfigService } from '../utils/configService';
import { ProgressReporter, CommitMessage } from '../models/types';

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

        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        };

        try {
            Logger.log('Sending request to custom endpoint');
            progress.report({ message: 'Generating commit message...', increment: 50 });
            const { data } = await axios.post(endpoint, payload, { headers });
            Logger.log('Custom endpoint response received successfully');
            progress.report({ message: 'Commit message generated successfully', increment: 100 });
            const message = this.extractCommitMessage(data);
            return { message, model };
        } catch (error) {
            Logger.error('Error generating commit message with custom endpoint:', error as Error);
            throw new Error(`Failed to generate commit message: ${(error as Error).message}`);
        }
    }

    private static extractCommitMessage(data: any): string {
        // Adjust this method based on the expected response format from your custom endpoint
        if (data.choices && data.choices[0] && data.choices[0].message) {
            return data.choices[0].message.content.trim();
        }
        throw new Error('Unexpected response format from custom endpoint');
    }
}