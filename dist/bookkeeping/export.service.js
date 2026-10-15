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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LedgerExportService = void 0;
exports.netOf = netOf;
exports.exportRowWithTaxes = exportRowWithTaxes;
const common_1 = require("@nestjs/common");
const exceljs_1 = __importDefault(require("exceljs"));
const pdfkit_1 = __importDefault(require("pdfkit"));
const prisma_service_1 = require("../prisma/prisma.service");
const opening_balance_query_1 = require("./opening-balance.query");
const opening_balance_util_1 = require("./opening-balance.util");
const splits_util_1 = require("./splits.util");
const statement_label_1 = require("./statement-label");
const fx_service_1 = require("./fx.service");
const tax_service_1 = require("./tax.service");
const tax_util_1 = require("./tax.util");
const BRAND = '#169F96';
function netOf(rows) {
    return rows.reduce((cents, r) => cents + Math.round(r.amount * 100), 0) / 100;
}
function exportRowWithTaxes(row, offsetAccount, lines) {
    if (!lines.length)
        return [row];
    const split = (0, tax_util_1.taxSplit)({ ...row, offsetAccount }, lines);
    return [
        { ...row, amount: split.parent.amount },
        ...split.taxes.map((e, i) => ({
            ...row,
            split: undefined,
            name: lines[i].name ?? row.name,
            amount: e.amount,
            debitAccount: e.debitAccount,
            creditAccount: e.creditAccount,
            tax: true,
        })),
    ];
}
const ISO = (d) => (d ? d.toISOString().slice(0, 10) : '');
const MONEY = (n) => n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});
let LedgerExportService = class LedgerExportService {
    prisma;
    tax;
    fx;
    constructor(prisma, tax, fx) {
        this.prisma = prisma;
        this.tax = tax;
        this.fx = fx;
    }
    async rowsFor(customerId) {
        const [rows, statements, taxes] = await Promise.all([
            this.prisma.bankTransaction.findMany({
                where: { customerId, statement: { deletedAt: null, status: 'DONE' } },
                include: {
                    statement: {
                        select: {
                            filename: true,
                            accountName: true,
                            bankName: true,
                            periodStart: true,
                            periodEnd: true,
                        },
                    },
                },
            }),
            (0, opening_balance_query_1.loadOpeningStatements)(this.prisma, customerId),
            this.tax.linesFor(customerId),
        ]);
        const byId = new Map(statements.map((s) => [s.id, s]));
        const openings = (0, opening_balance_util_1.openingRows)(statements);
        const totals = (0, splits_util_1.splitTotals)(rows.map((r) => ({ splitOfId: r.splitOfId, amount: Number(r.amount) })));
        const exportRow = (r) => ({
            id: r.splitOfId ?? r.id,
            statementId: r.statementId,
            pendingDate: r.pendingDate,
            postingDate: r.postingDate,
            name: [r.name, r.itemName].filter(Boolean).join(' · '),
            description: r.description,
            amount: (0, splits_util_1.remainderOf)({ ...r, amount: Number(r.amount) }, totals),
            debitAccount: r.debitAccount,
            creditAccount: r.creditAccount,
            statement: (0, statement_label_1.statementLabel)(r.statement),
            ...(r.splitOfId && { split: true }),
        });
        const splitsOf = new Map();
        for (const r of rows) {
            if (!r.splitOfId)
                continue;
            splitsOf.set(r.splitOfId, [...(splitsOf.get(r.splitOfId) ?? []), r]);
        }
        const sorted = [
            ...rows
                .filter((r) => !r.splitOfId)
                .map((r) => ({
                statementId: r.statementId,
                position: r.position,
                id: r.id,
                offsetAccount: r.offsetAccount,
                row: exportRow(r),
            })),
            ...openings.map((o) => ({
                statementId: o.statementId,
                position: opening_balance_util_1.OPENING_POSITION,
                id: 0,
                offsetAccount: o.offsetAccount,
                row: {
                    id: null,
                    statementId: o.statementId,
                    pendingDate: null,
                    postingDate: o.postingDate,
                    name: '',
                    description: o.description,
                    amount: o.amount,
                    debitAccount: o.debitAccount,
                    creditAccount: o.creditAccount,
                    statement: (0, statement_label_1.statementLabel)(byId.get(o.statementId)),
                },
            })),
        ].sort((a, b) => (0, opening_balance_util_1.ledgerOrder)({ ...a, postingDate: a.row.postingDate }, { ...b, postingDate: b.row.postingDate }));
        const out = sorted.flatMap((p) => [
            ...exportRowWithTaxes(p.row, p.offsetAccount, taxes.get(p.id) ?? []),
            ...(splitsOf.get(p.id) ?? [])
                .sort((a, b) => a.id - b.id)
                .flatMap((c) => exportRowWithTaxes(exportRow(c), c.offsetAccount, taxes.get(c.id) ?? [])),
        ]);
        const fx = await this.fx.context(customerId, statements);
        if (!fx.anyForeign)
            return out;
        const entries = [];
        const converted = out.map((r) => {
            const id = r.statementId;
            if (!fx.isForeign(id))
                return r;
            const { home, rate } = fx.convert(id, ISO(r.postingDate ?? r.pendingDate) || null, r.amount);
            entries.push({
                statementId: id,
                bankAccount: r.amount < 0 ? r.creditAccount : r.debitAccount,
                amount: r.amount,
                home,
            });
            return {
                ...r,
                currency: fx.currencyOf(id),
                fxRate: rate,
                homeAmount: home,
            };
        });
        const revalued = new Map(fx.revaluations(entries).map((f) => [f.statementId, f]));
        const lastOf = new Map(converted.map((r, i) => [r.statementId, i]));
        return converted.flatMap((r, i) => {
            const f = revalued.get(r.statementId);
            if (!f || lastOf.get(r.statementId) !== i)
                return [r];
            return [
                r,
                {
                    id: null,
                    statementId: f.statementId,
                    pendingDate: null,
                    postingDate: new Date(`${f.date}T00:00:00Z`),
                    name: '',
                    description: `Exchange rate on ${f.date}: ${f.rate.toFixed(4)}`,
                    amount: 0,
                    debitAccount: f.debitAccount,
                    creditAccount: f.creditAccount,
                    statement: r.statement,
                    currency: fx.currencyOf(f.statementId),
                    fxRate: f.rate,
                    homeAmount: f.homeAmount,
                },
            ];
        });
    }
    async excel(rows, customerName) {
        const wb = new exceljs_1.default.Workbook();
        wb.creator = 'CYG Finance';
        const ws = wb.addWorksheet('Ledger', {
            views: [{ state: 'frozen', ySplit: 1 }],
        });
        ws.columns = [
            { header: 'ID', key: 'id', width: 9 },
            {
                header: 'Pending date',
                key: 'pendingDate',
                width: 14,
                style: { numFmt: 'yyyy-mm-dd' },
            },
            {
                header: 'Posting date',
                key: 'postingDate',
                width: 14,
                style: { numFmt: 'yyyy-mm-dd' },
            },
            { header: 'Name', key: 'name', width: 24 },
            { header: 'Description', key: 'description', width: 46 },
            {
                header: 'Amount',
                key: 'amount',
                width: 14,
                style: { numFmt: '#,##0.00;[Red]-#,##0.00' },
            },
            { header: 'Debit', key: 'debitAccount', width: 28 },
            { header: 'Credit', key: 'creditAccount', width: 28 },
            { header: 'Statement', key: 'statement', width: 32 },
        ];
        const foreign = rows.some((r) => r.currency);
        if (foreign) {
            ws.columns = [
                ...ws.columns,
                { header: 'Currency', key: 'currency', width: 10 },
                {
                    header: 'Rate',
                    key: 'fxRate',
                    width: 11,
                    style: { numFmt: '0.0000' },
                },
                {
                    header: 'Home amount',
                    key: 'homeAmount',
                    width: 15,
                    style: { numFmt: '#,##0.00;[Red]-#,##0.00' },
                },
            ];
        }
        const header = ws.getRow(1);
        header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        header.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF169F96' },
        };
        for (const r of rows) {
            const { tax, split, ...cells } = r;
            const row = ws.addRow(foreign
                ? { ...cells, homeAmount: cells.homeAmount ?? cells.amount }
                : cells);
            if (tax)
                row.font = { italic: true, color: { argb: 'FF8A8F98' } };
            else if (split)
                row.font = { color: { argb: 'FF5B6470' } };
        }
        const count = rows.filter((r) => !r.tax && !r.split).length;
        const total = ws.addRow({
            description: `Net change (${count} transactions)`,
            amount: netOf(rows),
            ...(foreign && {
                homeAmount: netOf(rows.map((r) => ({ amount: r.homeAmount ?? r.amount }))),
            }),
        });
        total.font = { bold: true };
        ws.autoFilter = { from: 'A1', to: foreign ? 'L1' : 'I1' };
        wb.title = `${customerName} — ledger`;
        return Buffer.from(await wb.xlsx.writeBuffer());
    }
    pdf(rows, customerName) {
        return new Promise((resolve, reject) => {
            const doc = new pdfkit_1.default({
                size: 'LETTER',
                layout: 'landscape',
                margin: 36,
            });
            const chunks = [];
            doc.on('data', (c) => chunks.push(c));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);
            const cols = [
                { label: 'Pending', width: 56 },
                { label: 'Posting', width: 56 },
                { label: 'Name', width: 90 },
                { label: 'Description', width: 136 },
                { label: 'Amount', width: 66, align: 'right' },
                { label: 'Debit', width: 114 },
                { label: 'Credit', width: 114 },
                { label: 'Statement', width: 88 },
            ];
            const left = doc.page.margins.left;
            const bottom = () => doc.page.height - doc.page.margins.bottom;
            const dates = rows
                .map((r) => r.postingDate)
                .filter((d) => !!d);
            const period = dates.length
                ? `${ISO(dates[0])} to ${ISO(dates[dates.length - 1])}`
                : 'No dated transactions';
            doc
                .fillColor(BRAND)
                .font('Helvetica-Bold')
                .fontSize(18)
                .text('CYG Finance — Ledger');
            doc
                .fillColor('#333333')
                .font('Helvetica')
                .fontSize(10)
                .text(`${customerName}  ·  ${period}  ·  ${rows.filter((r) => !r.tax && !r.split).length} transactions  ·  generated ${ISO(new Date())}`);
            doc.moveDown(0.8);
            const drawHeader = () => {
                const y = doc.y;
                doc
                    .rect(left, y - 3, cols.reduce((s, c) => s + c.width, 0), 16)
                    .fill(BRAND);
                let x = left;
                doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8.5);
                for (const c of cols) {
                    doc.text(c.label, x + 3, y, {
                        width: c.width - 6,
                        align: c.align ?? 'left',
                    });
                    x += c.width;
                }
                doc.y = y + 16;
                doc.font('Helvetica').fillColor('#222222');
            };
            drawHeader();
            rows.forEach((r, i) => {
                const cells = [
                    ISO(r.pendingDate),
                    ISO(r.postingDate),
                    r.name,
                    r.description,
                    MONEY(r.amount),
                    r.debitAccount,
                    r.creditAccount,
                    r.statement,
                ];
                doc.fontSize(8.5);
                const h = Math.max(...cells.map((t, k) => doc.heightOfString(t, { width: cols[k].width - 6 }))) + 5;
                if (doc.y + h > bottom()) {
                    doc.addPage();
                    drawHeader();
                }
                const y = doc.y;
                if (i % 2 === 1) {
                    doc
                        .rect(left, y - 2, cols.reduce((s, c) => s + c.width, 0), h)
                        .fill('#F3F8F8');
                }
                let x = left;
                doc.font(r.tax ? 'Helvetica-Oblique' : 'Helvetica');
                cells.forEach((t, k) => {
                    doc
                        .fillColor(r.tax
                        ? '#8A8F98'
                        : k === 4
                            ? r.amount < 0
                                ? '#B42318'
                                : '#067647'
                            : '#222222')
                        .text(t, x + 3, y, {
                        width: cols[k].width - 6,
                        align: cols[k].align ?? 'left',
                    });
                    x += cols[k].width;
                });
                doc.y = y + h;
            });
            doc.font('Helvetica');
            const net = netOf(rows);
            doc
                .moveDown(0.6)
                .font('Helvetica-Bold')
                .fontSize(10)
                .fillColor('#222222')
                .text(`Net change: ${MONEY(net)}`, left, doc.y);
            doc.end();
        });
    }
};
exports.LedgerExportService = LedgerExportService;
exports.LedgerExportService = LedgerExportService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        tax_service_1.TaxService,
        fx_service_1.FxService])
], LedgerExportService);
//# sourceMappingURL=export.service.js.map