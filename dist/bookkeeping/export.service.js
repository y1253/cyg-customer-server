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
const common_1 = require("@nestjs/common");
const exceljs_1 = __importDefault(require("exceljs"));
const pdfkit_1 = __importDefault(require("pdfkit"));
const prisma_service_1 = require("../prisma/prisma.service");
const statement_label_1 = require("./statement-label");
const BRAND = '#169F96';
function netOf(rows) {
    return rows.reduce((cents, r) => cents + Math.round(r.amount * 100), 0) / 100;
}
const ISO = (d) => (d ? d.toISOString().slice(0, 10) : '');
const MONEY = (n) => n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});
let LedgerExportService = class LedgerExportService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async rowsFor(customerId) {
        const rows = await this.prisma.bankTransaction.findMany({
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
            orderBy: [
                { postingDate: 'asc' },
                { statementId: 'asc' },
                { position: 'asc' },
            ],
        });
        return rows.map((r) => ({
            pendingDate: r.pendingDate,
            postingDate: r.postingDate,
            name: r.name ?? '',
            description: r.description,
            amount: Number(r.amount),
            debitAccount: r.debitAccount,
            creditAccount: r.creditAccount,
            statement: (0, statement_label_1.statementLabel)(r.statement),
        }));
    }
    async excel(rows, customerName) {
        const wb = new exceljs_1.default.Workbook();
        wb.creator = 'CYG Finance';
        const ws = wb.addWorksheet('Ledger', {
            views: [{ state: 'frozen', ySplit: 1 }],
        });
        ws.columns = [
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
        const header = ws.getRow(1);
        header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        header.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF169F96' },
        };
        for (const r of rows)
            ws.addRow(r);
        const total = ws.addRow({
            description: `Net change (${rows.length} transactions)`,
            amount: netOf(rows),
        });
        total.font = { bold: true };
        ws.autoFilter = { from: 'A1', to: 'H1' };
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
                .text(`${customerName}  ·  ${period}  ·  ${rows.length} transactions  ·  generated ${ISO(new Date())}`);
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
                cells.forEach((t, k) => {
                    doc
                        .fillColor(k === 4 ? (r.amount < 0 ? '#B42318' : '#067647') : '#222222')
                        .text(t, x + 3, y, {
                        width: cols[k].width - 6,
                        align: cols[k].align ?? 'left',
                    });
                    x += cols[k].width;
                });
                doc.y = y + h;
            });
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
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], LedgerExportService);
//# sourceMappingURL=export.service.js.map