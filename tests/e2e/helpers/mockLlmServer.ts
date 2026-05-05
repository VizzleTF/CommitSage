import * as http from 'node:http';
import { AddressInfo } from 'node:net';

export interface MockResponseStep {
    status?: number;
    body?: unknown;
    delayMs?: number;
    rawBody?: string;
}

export interface CapturedRequest {
    url: string;
    method: string;
    headers: http.IncomingHttpHeaders;
    body: unknown;
    rawBody: string;
}

const DEFAULT_OPENAI_BODY = {
    choices: [{ message: { content: 'feat: test commit message' } }]
};

const DEFAULT_OLLAMA_BODY = {
    message: { content: 'feat: ollama mock' }
};

export class MockLlmServer {
    private server!: http.Server;
    private steps: MockResponseStep[] = [];
    public readonly requests: CapturedRequest[] = [];

    async start(): Promise<{ baseUrl: string; ollamaBaseUrl: string; port: number }> {
        this.server = http.createServer(async (req, res) => {
            const chunks: Buffer[] = [];
            for await (const c of req) chunks.push(c as Buffer);
            const raw = Buffer.concat(chunks).toString('utf8');
            let parsed: unknown = raw;
            try { parsed = raw ? JSON.parse(raw) : {}; } catch { /* keep raw */ }
            this.requests.push({
                url: req.url ?? '',
                method: req.method ?? 'GET',
                headers: req.headers,
                body: parsed,
                rawBody: raw,
            });

            const step = this.steps.shift();
            const status = step?.status ?? 200;
            if (step?.delayMs) {
                await new Promise(r => setTimeout(r, step.delayMs));
            }

            res.statusCode = status;
            res.setHeader('content-type', 'application/json');
            if (step?.rawBody !== undefined) {
                res.end(step.rawBody);
                return;
            }
            const isOllama = (req.url ?? '').includes('/api/chat');
            const defaultBody = isOllama ? DEFAULT_OLLAMA_BODY : DEFAULT_OPENAI_BODY;
            res.end(JSON.stringify(step?.body ?? defaultBody));
        });
        await new Promise<void>((resolve, reject) => {
            this.server.once('error', reject);
            this.server.listen(0, '127.0.0.1', () => {
                this.server.removeListener('error', reject);
                resolve();
            });
        });
        const port = (this.server.address() as AddressInfo).port;
        return {
            baseUrl: `http://127.0.0.1:${port}/v1`,
            ollamaBaseUrl: `http://127.0.0.1:${port}`,
            port,
        };
    }

    enqueue(...steps: MockResponseStep[]): void {
        this.steps.push(...steps);
    }

    reset(): void {
        this.steps.length = 0;
        this.requests.length = 0;
    }

    async stop(): Promise<void> {
        await new Promise<void>(resolve => this.server.close(() => resolve()));
    }
}
