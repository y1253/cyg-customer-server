import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const CHAT_URL = 'https://api.openai.com/v1/chat/completions';

export type ChatContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'file'; file: { filename: string; file_data: string } }
    >;

export interface ChatRequest {
  model: string;
  system: string;
  user: ChatContent;
  /** A JSON schema the reply must satisfy (OpenAI structured outputs, strict). */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  temperature?: number;
  maxTokens?: number;
  timeoutMs: number;
}

/**
 * The one way this server talks to OpenAI: plain `fetch`, like the internal app's
 * `AiService.chat` (no SDK). Never logs a key, a prompt or a document — only the model,
 * the status and the timing.
 */
@Injectable()
export class OpenAiClient {
  private readonly logger = new Logger(OpenAiClient.name);

  constructor(private readonly config: ConfigService) {}

  get configured(): boolean {
    return Boolean(this.config.get<string>('OPENAI_API_KEY')?.trim());
  }

  /** The reply text (for a schema request: the JSON string). */
  async chat(req: ChatRequest): Promise<string> {
    const key = this.config.get<string>('OPENAI_API_KEY')?.trim();
    if (!key) throw new BadGatewayException('The AI service is not configured');

    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: req.model,
          temperature: req.temperature ?? 0,
          max_tokens: req.maxTokens,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
          ...(req.jsonSchema && {
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: req.jsonSchema.name,
                strict: true,
                schema: req.jsonSchema.schema,
              },
            },
          }),
        }),
        signal: AbortSignal.timeout(req.timeoutMs),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.name : 'error';
      this.logger.warn(
        `openai ${req.model} FAILED ${reason} ${Date.now() - started}ms`,
      );
      throw new BadGatewayException('The AI service could not be reached');
    }

    const data = (await res.json().catch(() => null)) as {
      error?: { message?: string };
      choices?: Array<{
        message?: { content?: string | null; refusal?: string | null };
        finish_reason?: string;
      }>;
    } | null;
    this.logger.log(
      `openai ${req.model} ${res.status} ${Date.now() - started}ms`,
    );

    if (!res.ok) {
      throw new BadGatewayException(
        data?.error?.message ?? `The AI service answered ${res.status}`,
      );
    }
    const choice = data?.choices?.[0];
    if (choice?.message?.refusal) {
      throw new BadGatewayException('The AI declined to read this document');
    }
    if (choice?.finish_reason === 'length') {
      throw new BadGatewayException(
        'The AI reply was cut off (document section too long)',
      );
    }
    const content = choice?.message?.content?.trim();
    if (!content)
      throw new BadGatewayException('The AI returned an empty reply');
    return content;
  }
}
