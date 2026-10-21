"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var VoiceGateway_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoiceGateway = exports.VOICE_WS_PATH = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const ws_1 = require("ws");
const assistant_tools_1 = require("../assistant/assistant-tools");
const assistant_service_1 = require("../assistant/assistant.service");
const signalwire_client_1 = require("../messaging/signalwire.client");
const prisma_service_1 = require("../prisma/prisma.service");
const voice_calls_service_1 = require("./voice-calls.service");
const voice_session_1 = require("./voice-session");
exports.VOICE_WS_PATH = '/api/voice/stream';
let VoiceGateway = VoiceGateway_1 = class VoiceGateway {
    prisma;
    config;
    calls;
    assistant;
    tools;
    signalwire;
    logger = new common_1.Logger(VoiceGateway_1.name);
    wss = new ws_1.WebSocketServer({ noServer: true });
    constructor(prisma, config, calls, assistant, tools, signalwire) {
        this.prisma = prisma;
        this.config = config;
        this.calls = calls;
        this.assistant = assistant;
        this.tools = tools;
        this.signalwire = signalwire;
    }
    attach(server) {
        server.on('upgrade', (req, socket, head) => {
            const path = (req.url ?? '').split('?')[0];
            if (path !== exports.VOICE_WS_PATH)
                return;
            this.wss.handleUpgrade(req, socket, head, (ws) => {
                new voice_session_1.VoiceSession(ws, {
                    prisma: this.prisma,
                    calls: this.calls,
                    assistant: this.assistant,
                    tools: this.tools,
                    signalwire: this.signalwire,
                    openaiKey: this.config.get('OPENAI_API_KEY')?.trim() || null,
                    model: this.config.get('OPENAI_REALTIME_MODEL')?.trim() || null,
                });
            });
        });
        this.logger.log(`voice stream on ${exports.VOICE_WS_PATH}`);
    }
    onModuleDestroy() {
        for (const c of this.wss.clients)
            c.terminate();
        this.wss.close();
    }
};
exports.VoiceGateway = VoiceGateway;
exports.VoiceGateway = VoiceGateway = VoiceGateway_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService,
        voice_calls_service_1.VoiceCallsService,
        assistant_service_1.AssistantService,
        assistant_tools_1.AssistantTools,
        signalwire_client_1.SignalWireClient])
], VoiceGateway);
//# sourceMappingURL=voice.gateway.js.map