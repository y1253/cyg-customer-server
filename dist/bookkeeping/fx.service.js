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
var FxService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.FxService = exports.FxContext = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const fx_util_1 = require("./fx.util");
const VALET = 'https://www.bankofcanada.ca/valet/observations';
const LOOKBACK_DAYS = 10;
const RETRY_MS = 60 * 60_000;
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (date, n) => iso(new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000));
class FxContext {
    home;
    statements;
    series;
    constructor(home, statements, series) {
        this.home = home;
        this.statements = statements;
        this.series = series;
    }
    currencyOf(statementId) {
        return this.statements.get(statementId)?.currency || this.home;
    }
    isForeign(statementId) {
        return this.currencyOf(statementId) !== this.home;
    }
    get anyForeign() {
        return [...this.statements.keys()].some((id) => this.isForeign(id));
    }
    rate(statementId, date) {
        const from = this.currencyOf(statementId);
        if (from === this.home)
            return 1;
        const s = this.statements.get(statementId);
        const day = date ??
            (s?.periodEnd ? iso(s.periodEnd) : null) ??
            (s?.periodStart ? iso(s.periodStart) : null);
        if (!day)
            return null;
        return (0, fx_util_1.rateOn)(from, this.home, day, (c) => this.series.get(c));
    }
    convert(statementId, date, amount) {
        const rate = this.rate(statementId, date);
        return { home: rate === null ? amount : (0, fx_util_1.toHome)(amount, rate), rate };
    }
    revaluations(entries) {
        const per = new Map();
        for (const e of entries) {
            if (!this.isForeign(e.statementId))
                continue;
            const t = per.get(e.statementId) ?? {
                bankAccount: e.bankAccount,
                foreign: 0,
                home: 0,
            };
            t.foreign += e.amount;
            t.home += e.home;
            per.set(e.statementId, t);
        }
        return (0, fx_util_1.revaluationRows)([...per.entries()].map(([statementId, t]) => {
            const end = this.statements.get(statementId)?.periodEnd ?? null;
            const periodEnd = end ? iso(end) : null;
            return {
                statementId,
                bankAccount: t.bankAccount,
                periodEnd,
                foreign: Math.round(t.foreign * 100) / 100,
                home: Math.round(t.home * 100) / 100,
                closingRate: periodEnd ? this.rate(statementId, periodEnd) : null,
            };
        }));
    }
}
exports.FxContext = FxContext;
let FxService = FxService_1 = class FxService {
    prisma;
    logger = new common_1.Logger(FxService_1.name);
    tried = new Map();
    constructor(prisma) {
        this.prisma = prisma;
    }
    async home(scope) {
        const b = await this.prisma.book.findUnique({
            where: { id: scope.bookId },
            select: { homeCurrency: true },
        });
        return b?.homeCurrency || 'CAD';
    }
    async setHome(scope, currency) {
        const code = currency.trim().toUpperCase();
        if (!(0, fx_util_1.isFxCurrency)(code)) {
            throw new common_1.BadRequestException(`${code} is not a currency we have daily rates for`);
        }
        await this.prisma.book.update({
            where: { id: scope.bookId },
            data: { homeCurrency: code },
        });
        return code;
    }
    currencies() {
        return fx_util_1.FX_CURRENCIES;
    }
    async context(scope, statements) {
        const home = await this.home(scope);
        const byId = new Map(statements.map((s) => [s.id, s]));
        const foreign = statements.filter((s) => (s.currency || home) !== home);
        const series = new Map();
        if (foreign.length) {
            const days = foreign.flatMap((s) => [s.periodStart, s.periodEnd].filter((d) => !!d).map(iso));
            if (days.length) {
                const from = addDays(days.reduce((a, b) => (a < b ? a : b)), -LOOKBACK_DAYS);
                const to = days.reduce((a, b) => (a > b ? a : b));
                const wanted = new Set([home, ...foreign.map((s) => s.currency)].filter((c) => c !== 'CAD'));
                for (const c of wanted)
                    series.set(c, await this.series(c, from, to));
            }
        }
        return new FxContext(home, byId, series);
    }
    async series(currency, from, to) {
        const load = () => this.prisma.fxRate.findMany({
            where: {
                currency,
                date: {
                    gte: new Date(`${from}T00:00:00Z`),
                    lte: new Date(`${to}T00:00:00Z`),
                },
            },
            select: { date: true, cadPer: true },
            orderBy: { date: 'asc' },
        });
        let rows = await load();
        const today = iso(new Date());
        const end = to < today ? to : addDays(today, -1);
        const covered = rows.length > 0 &&
            iso(rows[0].date) <= addDays(from, LOOKBACK_DAYS) &&
            iso(rows[rows.length - 1].date) >= addDays(end, -5);
        const key = `${currency}:${from}:${to}`;
        if (!covered && Date.now() - (this.tried.get(key) ?? 0) > RETRY_MS) {
            this.tried.set(key, Date.now());
            await this.fetchValet(currency, from, to);
            rows = await load();
        }
        return rows.map((r) => ({ date: iso(r.date), cadPer: Number(r.cadPer) }));
    }
    async fetchValet(currency, from, to) {
        const series = `FX${currency}CAD`;
        try {
            const res = await fetch(`${VALET}/${series}/json?start_date=${from}&end_date=${to}`, { signal: AbortSignal.timeout(15_000) });
            if (!res.ok)
                throw new Error(`HTTP ${res.status}`);
            const body = (await res.json());
            const data = (body.observations ?? []).flatMap((o) => {
                const d = typeof o.d === 'string' ? o.d : null;
                const v = o[series]?.v;
                const n = v ? Number(v) : NaN;
                return d && Number.isFinite(n) && n > 0
                    ? [
                        {
                            currency,
                            date: new Date(`${d}T00:00:00Z`),
                            cadPer: n.toFixed(8),
                        },
                    ]
                    : [];
            });
            if (data.length) {
                await this.prisma.fxRate.createMany({ data, skipDuplicates: true });
            }
            this.logger.log(`${series} ${from}…${to}: ${data.length} rate(s)`);
        }
        catch (err) {
            this.logger.warn(`${series} ${from}…${to} not fetched: ${err.message}`);
        }
    }
};
exports.FxService = FxService;
exports.FxService = FxService = FxService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], FxService);
//# sourceMappingURL=fx.service.js.map