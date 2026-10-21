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
var SignalWireClient_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignalWireClient = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const TIMEOUT_MS = 20_000;
const MEDIA_TIMEOUT_MS = 60_000;
const str = (v) => typeof v === 'string' && v.trim() ? v : null;
const num = (v) => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
};
let SignalWireClient = SignalWireClient_1 = class SignalWireClient {
    config;
    logger = new common_1.Logger(SignalWireClient_1.name);
    constructor(config) {
        this.config = config;
    }
    env(key) {
        return this.config.get(key)?.trim() || null;
    }
    get configured() {
        return !!(this.env('SIGNALWIRE_PROJECT_ID') &&
            this.env('SIGNALWIRE_API_TOKEN') &&
            this.env('SIGNALWIRE_SPACE_URL'));
    }
    base() {
        const space = this.env('SIGNALWIRE_SPACE_URL')
            .replace(/^https?:\/\//, '')
            .replace(/\/+$/, '');
        return `https://${space}/api/laml/2010-04-01/Accounts/${this.env('SIGNALWIRE_PROJECT_ID')}`;
    }
    auth() {
        return `Basic ${Buffer.from(`${this.env('SIGNALWIRE_PROJECT_ID')}:${this.env('SIGNALWIRE_API_TOKEN')}`).toString('base64')}`;
    }
    async request(label, path, init) {
        if (!this.configured)
            throw new Error('SignalWire is not configured');
        const url = new URL(this.base() + path);
        for (const [k, v] of Object.entries(init.query ?? {})) {
            if (v)
                url.searchParams.set(k, v);
        }
        let body;
        if (init.form) {
            const params = new URLSearchParams();
            for (const [k, v] of Object.entries(init.form))
                if (v)
                    params.set(k, v);
            body = params.toString();
        }
        const res = await fetch(url, {
            method: init.method,
            headers: {
                Authorization: this.auth(),
                Accept: 'application/json',
                ...(body
                    ? { 'Content-Type': 'application/x-www-form-urlencoded' }
                    : {}),
            },
            body,
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const text = await res.text();
        if (!res.ok) {
            this.logger.warn(`${label} ${res.status}: ${text.slice(0, 300)}`);
            throw new Error(`SignalWire ${label} ${res.status}: ${text.slice(0, 200)}`);
        }
        try {
            return (JSON.parse(text) ?? {});
        }
        catch {
            return {};
        }
    }
    async createCall(input) {
        const data = await this.request(`createCall to=${mask(input.to)}`, '/Calls', {
            method: 'POST',
            form: {
                To: input.to,
                From: input.from,
                Laml: input.laml,
                StatusCallback: input.statusCallback ?? undefined,
                StatusCallbackMethod: input.statusCallback ? 'POST' : undefined,
                Timeout: String(input.timeoutSec ?? 30),
                Record: input.record ? 'true' : undefined,
                RecordingChannels: input.record ? 'dual' : undefined,
            },
        });
        const sid = str(data.sid);
        if (!sid)
            throw new Error('SignalWire returned no call sid');
        return sid;
    }
    async startRecording(callSid) {
        try {
            const data = await this.request(`startRecording ${callSid}`, `/Calls/${encodeURIComponent(callSid)}/Recordings`, { method: 'POST', form: { RecordingChannels: 'dual' } });
            return str(data.sid);
        }
        catch {
            return null;
        }
    }
    async getCall(callSid) {
        try {
            const d = await this.request(`getCall ${callSid}`, `/Calls/${encodeURIComponent(callSid)}`, { method: 'GET' });
            const sid = str(d.sid);
            return sid
                ? { sid, status: str(d.status) ?? '', durationSec: num(d.duration) }
                : null;
        }
        catch {
            return null;
        }
    }
    async listRecordings(callSid) {
        try {
            const d = await this.request(`listRecordings ${callSid}`, '/Recordings', {
                method: 'GET',
                query: { CallSid: callSid, PageSize: '20' },
            });
            const list = Array.isArray(d.recordings) ? d.recordings : [];
            return list.flatMap((row) => {
                const r = (row ?? {});
                const sid = str(r.sid);
                return sid
                    ? [
                        {
                            sid,
                            callSid: str(r.call_sid),
                            durationSec: num(r.duration),
                            status: str(r.status) ?? '',
                        },
                    ]
                    : [];
            });
        }
        catch {
            return [];
        }
    }
    async fetchRecording(sid) {
        const res = await fetch(`${this.base()}/Recordings/${encodeURIComponent(sid)}.mp3`, {
            headers: { Authorization: this.auth() },
            signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
        });
        if (!res.ok)
            throw new Error(`recording ${sid}: ${res.status}`);
        return Buffer.from(await res.arrayBuffer());
    }
    async hangup(callSid) {
        try {
            await this.request(`hangup ${callSid}`, `/Calls/${encodeURIComponent(callSid)}`, {
                method: 'POST',
                form: { Status: 'completed' },
            });
        }
        catch {
        }
    }
};
exports.SignalWireClient = SignalWireClient;
exports.SignalWireClient = SignalWireClient = SignalWireClient_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], SignalWireClient);
function mask(phone) {
    return phone.length > 8 ? `${phone.slice(0, 5)}***${phone.slice(-4)}` : '***';
}
//# sourceMappingURL=signalwire.client.js.map