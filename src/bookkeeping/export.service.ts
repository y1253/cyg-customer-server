import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../prisma/prisma.service';
import { loadOpeningStatements } from './opening-balance.query';
import {
  ledgerOrder,
  OPENING_POSITION,
  openingRows,
} from './opening-balance.util';
import { statementLabel } from './statement-label';
import { TaxService } from './tax.service';
import { taxEntry, withTaxRows } from './tax.util';

export interface LedgerExportRow {
  pendingDate: Date | null;
  postingDate: Date | null;
  name: string;
  description: string;
  amount: number;
  debitAccount: string;
  creditAccount: string;
  statement: string;
  /** A tax line under the row above it: drawn grey italic, left out of the net change. */
  tax?: boolean;
}

const BRAND = '#169F96';

/**
 * Sum in whole cents: adding 150 float amounts drifts (-5808.8399999999965). Tax lines
 * move no cash, so they never count.
 */
export function netOf(rows: Array<{ amount: number; tax?: boolean }>): number {
  return (
    rows.reduce(
      (cents, r) => (r.tax ? cents : cents + Math.round(r.amount * 100)),
      0,
    ) / 100
  );
}
const ISO = (d: Date | null): string => (d ? d.toISOString().slice(0, 10) : '');
const MONEY = (n: number): string =>
  n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/**
 * The downloadable ledger: ALWAYS every statement of the customer combined, ordered by
 * posting date — the columns of the firm's own sheet (pending date, posting date,
 * name, description, amount, debit, credit).
 */
@Injectable()
export class LedgerExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tax: TaxService,
  ) {}

  async rowsFor(customerId: number): Promise<LedgerExportRow[]> {
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
      loadOpeningStatements(this.prisma, customerId),
      this.tax.linesFor(customerId),
    ]);
    const byId = new Map(statements.map((s) => [s.id, s]));
    const openings = openingRows(statements);

    // Oldest first: a statement's Starting balance row comes before its first row, and
    // each row's tax lines sit directly under it.
    const sorted = [
      ...rows.map((r) => ({
        statementId: r.statementId,
        position: r.position,
        id: r.id,
        offsetAccount: r.offsetAccount,
        row: {
          pendingDate: r.pendingDate,
          postingDate: r.postingDate,
          name: r.name ?? '',
          description: r.description,
          amount: Number(r.amount),
          debitAccount: r.debitAccount,
          creditAccount: r.creditAccount,
          statement: statementLabel(r.statement),
        },
      })),
      ...openings.map((o) => ({
        statementId: o.statementId,
        position: OPENING_POSITION,
        id: 0,
        offsetAccount: o.offsetAccount,
        row: {
          pendingDate: null,
          postingDate: o.postingDate,
          name: '',
          description: o.description,
          amount: o.amount,
          debitAccount: o.debitAccount,
          creditAccount: o.creditAccount,
          statement: statementLabel(byId.get(o.statementId)!),
        },
      })),
    ].sort((a, b) =>
      ledgerOrder(
        { ...a, postingDate: a.row.postingDate },
        { ...b, postingDate: b.row.postingDate },
      ),
    );
    return withTaxRows(sorted, (p) =>
      taxes.get(p.id)?.map((t) => ({
        ...p,
        row: {
          ...p.row,
          amount: t.amount,
          ...taxEntry(t.kind, p.offsetAccount, t.agency),
          tax: true,
        },
      })),
    ).map((x) => x.row);
  }

  async excel(rows: LedgerExportRow[], customerName: string): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
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
    for (const r of rows) {
      const { tax, ...cells } = r;
      const row = ws.addRow(cells);
      if (tax) row.font = { italic: true, color: { argb: 'FF8A8F98' } };
    }
    const count = rows.filter((r) => !r.tax).length;
    const total = ws.addRow({
      description: `Net change (${count} transactions)`,
      amount: netOf(rows),
    });
    total.font = { bold: true };
    ws.autoFilter = { from: 'A1', to: 'H1' };
    wb.title = `${customerName} — ledger`;
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  pdf(rows: LedgerExportRow[], customerName: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'LETTER',
        layout: 'landscape',
        margin: 36,
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const cols = [
        { label: 'Pending', width: 56 },
        { label: 'Posting', width: 56 },
        { label: 'Name', width: 90 },
        { label: 'Description', width: 136 },
        { label: 'Amount', width: 66, align: 'right' as const },
        { label: 'Debit', width: 114 },
        { label: 'Credit', width: 114 },
        { label: 'Statement', width: 88 },
      ];
      const left = doc.page.margins.left;
      const bottom = () => doc.page.height - doc.page.margins.bottom;

      const dates = rows
        .map((r) => r.postingDate)
        .filter((d): d is Date => !!d);
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
        .text(
          `${customerName}  ·  ${period}  ·  ${rows.filter((r) => !r.tax).length} transactions  ·  generated ${ISO(new Date())}`,
        );
      doc.moveDown(0.8);

      const drawHeader = () => {
        const y = doc.y;
        doc
          .rect(
            left,
            y - 3,
            cols.reduce((s, c) => s + c.width, 0),
            16,
          )
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
        const h =
          Math.max(
            ...cells.map((t, k) =>
              doc.heightOfString(t, { width: cols[k].width - 6 }),
            ),
          ) + 5;
        if (doc.y + h > bottom()) {
          doc.addPage();
          drawHeader();
        }
        const y = doc.y;
        if (i % 2 === 1) {
          doc
            .rect(
              left,
              y - 2,
              cols.reduce((s, c) => s + c.width, 0),
              h,
            )
            .fill('#F3F8F8');
        }
        let x = left;
        doc.font(r.tax ? 'Helvetica-Oblique' : 'Helvetica');
        cells.forEach((t, k) => {
          doc
            .fillColor(
              r.tax
                ? '#8A8F98'
                : k === 4
                  ? r.amount < 0
                    ? '#B42318'
                    : '#067647'
                  : '#222222',
            )
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
}
