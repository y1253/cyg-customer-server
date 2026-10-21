import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IncomingMessage, Server } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer } from 'ws';
import { AssistantTools } from '../assistant/assistant-tools';
import { AssistantService } from '../assistant/assistant.service';
import { SignalWireClient } from '../messaging/signalwire.client';
import { PrismaService } from '../prisma/prisma.service';
import { VoiceCallsService } from './voice-calls.service';
import { VoiceSession } from './voice-session';

/** The one WebSocket path on this server: SignalWire's media stream for an AI call. */
export const VOICE_WS_PATH = '/api/voice/stream';

/**
 * step12: accepts SignalWire's `<Connect><Stream>` WebSocket and hands each call to a
 * `VoiceSession`. Attached to the HTTP server in `main.ts` (the internal app's
 * `RealtimeGateway` pattern — `noServer`, raw `upgrade`, one path). Who may stream is
 * decided by the token in the stream's `start` event (`VoiceCallsService.verify`), since
 * SignalWire cannot send headers or an auth frame.
 */
@Injectable()
export class VoiceGateway implements OnModuleDestroy {
  private readonly logger = new Logger(VoiceGateway.name);
  private readonly wss = new WebSocketServer({ noServer: true });

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly calls: VoiceCallsService,
    private readonly assistant: AssistantService,
    private readonly tools: AssistantTools,
    private readonly signalwire: SignalWireClient,
  ) {}

  attach(server: Server): void {
    server.on(
      'upgrade',
      (req: IncomingMessage, socket: Duplex, head: Buffer) => {
        const path = (req.url ?? '').split('?')[0];
        if (path !== VOICE_WS_PATH) return;
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          new VoiceSession(ws, {
            prisma: this.prisma,
            calls: this.calls,
            assistant: this.assistant,
            tools: this.tools,
            signalwire: this.signalwire,
            openaiKey:
              this.config.get<string>('OPENAI_API_KEY')?.trim() || null,
            model:
              this.config.get<string>('OPENAI_REALTIME_MODEL')?.trim() || null,
          });
        });
      },
    );
    this.logger.log(`voice stream on ${VOICE_WS_PATH}`);
  }

  onModuleDestroy(): void {
    for (const c of this.wss.clients) c.terminate();
    this.wss.close();
  }
}
