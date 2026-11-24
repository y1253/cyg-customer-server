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
Object.defineProperty(exports, "__esModule", { value: true });
exports.NamesQueryService = void 0;
const common_1 = require("@nestjs/common");
const tax_service_1 = require("./tax.service");
const sub_names_service_1 = require("./sub-names.service");
const names_query_util_1 = require("./names-query.util");
let NamesQueryService = class NamesQueryService {
    tax;
    subNames;
    constructor(tax, subNames) {
        this.tax = tax;
        this.subNames = subNames;
    }
    async load(scope, rawQ) {
        const q = (rawQ ?? '').trim().toLowerCase();
        const [view, subs, found] = await Promise.all([
            this.tax.names(scope),
            this.subNames.list(scope),
            q.length >= 2
                ? this.tax.searchDescriptions(scope, q)
                : Promise.resolve([]),
        ]);
        const hits = new Map();
        for (const h of found) {
            const k = h.name.toLowerCase();
            hits.set(k, (hits.get(k) ?? new Set()).add(h.key));
        }
        return { q, view, subs: (0, names_query_util_1.subsByParent)(subs), hits };
    }
    async page(scope, query, offset, limit) {
        const { q, view, subs, hits } = await this.load(scope, query.q);
        const list = (0, names_query_util_1.filterNames)(view, subs, { filter: query.filter, q, hits });
        const { items, nextOffset } = (0, names_query_util_1.pageOfNames)(list, offset, limit);
        const subNames = items.flatMap((n) => subs.get(n.name.toLowerCase()) ?? []);
        const ids = subNames.map((s) => s.id);
        const matches = {};
        for (const n of items) {
            const h = hits.get(n.name.toLowerCase());
            if (h)
                matches[n.name.toLowerCase()] = [...h];
        }
        return {
            names: items,
            nextOffset,
            total: list.length,
            subNames,
            subDescriptions: (0, names_query_util_1.pickSubs)(view.subDescriptions, ids),
            subContains: (0, names_query_util_1.pickSubs)(view.subContains, ids),
            subExceptionOf: (0, names_query_util_1.pickSubs)(view.subExceptionOf, ids),
            matches,
            ...(offset === 0 && { head: this.head(view, subs, q, hits) }),
        };
    }
    head(view, subs, q, hits) {
        const unclarified = view.names.find((n) => n.unclarified) ?? null;
        const unrecognized = (0, names_query_util_1.filterUnrecognized)(view.unrecognized, q);
        return {
            groups: view.groups,
            counts: {
                ...(0, names_query_util_1.groupCounts)(view, subs, { q, hits }),
                UNRECOGNIZED: unrecognized.length,
            },
            unclarified: unclarified && (0, names_query_util_1.nameMatches)(unclarified, [], view, { q, hits })
                ? unclarified
                : null,
            unrecognizedCount: unrecognized.length,
            containsRules: (0, names_query_util_1.filterContains)(view.containsRules, q),
        };
    }
    async unrecognized(scope, rawQ) {
        const view = await this.tax.names(scope);
        return (0, names_query_util_1.filterUnrecognized)(view.unrecognized, (rawQ ?? '').trim().toLowerCase());
    }
};
exports.NamesQueryService = NamesQueryService;
exports.NamesQueryService = NamesQueryService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [tax_service_1.TaxService,
        sub_names_service_1.SubNamesService])
], NamesQueryService);
//# sourceMappingURL=names-query.service.js.map