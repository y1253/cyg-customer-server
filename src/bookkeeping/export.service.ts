import { Injectable, Optional } from '@nestjs/common';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../prisma/prisma.service';
import { loadOpeningStatements } from './opening-balance.query';
import {
  ledgerOrder,
  OPENING_POSITION,
  openingRows,
} from './opening-balance.util';
import { remainderOf, splitTotals } from './splits.util';
import { statementLabel } from './statement-label';
import { FxService, type FxEntry } from './fx.service';
import { CustomColumnsService } from './custom-columns.service';
import { scopeWhere, type BookScope } from './scope';

export interface LedgerExportRow {
  /**
   * The transaction's id — and the SAME id on each of its splits, so the
   * customer can see in Excel which lines belong to one transaction. Null on a
   * starting-balance row.
   */
  id: number | null;
  /** Not a cell: the row's OWN id (a split's, not its transaction's) — its custom answers. */
  rowId?: number;
  pendingDate: Date | null;
  postingDate: Date | null;
  name: string;
  description: string;
  /** step2 (2026-11-15): the Product column — the receipt line the row is for. */
  product?: string;
  amount: number;
  debitAccount: string;
  creditAccount: string;
  statement: string;
  /** HISTORY (tax lines on read, gone since step9 part 4): grey italic. Never set now. */
  tax?: boolean;
  /** A part split off the transaction above (by hand or a split rule): grey. */
  split?: boolean;
  /** Not a cell: the statement it belongs to (for the home-currency conversion). */
  statementId?: number;
  /** A foreign statement's row: its currency, the day's rate and the amount converted. */
  currency?: string;
  fxRate?: number | null;
  homeAmount?: number;
}

/**
 * step8 (2026-11-11): the customer's own ledger columns — headers in order, and per
 * row id its cells. step9 (2026-11-19): a split line shows its own answers.
 */
export interface ExportCustomColumns {
  headers: string[];
  cells: Map<number, string[]>;
}

/** A row's cells in the custom columns ('' when none). */
function customCellsOf(
  r: LedgerExportRow,
  custom?: ExportCustomColumns,
): string[] {
  if (!custom) return [];
  const cells =
    r.id !== null && !r.tax ? custom.cells.get(r.rowId ?? r.id) : undefined;
  return custom.headers.map((_, i) => cells?.[i] ?? '');
}

const BRAND = '#169F96';

/**
 * Sum in whole cents: adding 150 float amounts drifts (-5808.8399999999965). A split row
 * and its splits add back to the bank amount, so this is the statements' net change.
 */
export function netOf(rows: Array<{ amount: number }>): number {
  return rows.reduce((cents, r) => cents + Math.round(r.amount * 100), 0) / 100;
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
    private readonly fx: FxService,
    @Optional() private readonly customColumns?: CustomColumnsService,
  ) {}

  /** step8: the book's own columns, for `excel` / `pdf` (none when it has none). */
  async customFor(scope: BookScope): Promise<ExportCustomColumns | undefined> {
    if (!this.customColumns) return undefined;
    const { columns, cells } = await this.customColumns.exportCells(scope);
    return columns.length
      ? { headers: columns.map((c) => c.name), cells }
      : undefined;
  }

  async rowsFor(scope: BookScope): Promise<LedgerExportRow[]> {
    const [rows, statements, subNames] = await Promise.all([
      this.prisma.bankTransaction.findMany({
        where: {
          ...scopeWhere(scope),
          statement: { deletedAt: null, status: 'DONE' },
        },
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
      loadOpeningStatements(this.prisma, scope),
      this.prisma.subName.findMany({
        where: { bookId: scope.bookId },
        select: { id: true, name: true },
      }),
    ]);
    const subNameOf = new Map(subNames.map((s) => [s.id, s.name]));
    const byId = new Map(statements.map((s) => [s.id, s]));
    const openings = openingRows(statements);
    const totals = splitTotals(
      rows.map((r) => ({ splitOfId: r.splitOfId, amount: Number(r.amount) })),
    );
    const exportRow = (r: (typeof rows)[number]) => ({
      id: r.splitOfId ?? r.id,
      rowId: r.id,
      statementId: r.statementId,
      pendingDate: r.pendingDate,
      postingDate: r.postingDate,
      // step2 (2026-11-15): a split under a sub-name reads "Walmart - Maintenance".
      name:
        (r.subNameId !== null ? subNameOf.get(r.subNameId) : undefined) ??
        r.name ??
        '',
      description: r.description,
      product: r.itemName ?? '',
      amount: remainderOf({ ...r, amount: Number(r.amount) }, totals),
      debitAccount: r.debitAccount,
      creditAccount: r.creditAccount,
      statement: statementLabel(r.statement),
      ...(r.splitOfId && { split: true }),
    });
    const splitsOf = new Map<number, Array<(typeof rows)[number]>>();
    for (const r of rows) {
      if (!r.splitOfId) continue;
      splitsOf.set(r.splitOfId, [...(splitsOf.get(r.splitOfId) ?? []), r]);
    }

    // Oldest first: a statement's Starting balance row comes before its first row, and
    // each row's splits sit directly under it.
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
        position: OPENING_POSITION,
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
          statement: statementLabel(byId.get(o.statementId)!),
        },
      })),
    ].sort((a, b) =>
      ledgerOrder(
        { ...a, postingDate: a.row.postingDate },
        { ...b, postingDate: b.row.postingDate },
      ),
    );
    // Each transaction, then its splits (step9 part 4: a split rule's too).
    const out = sorted.flatMap((p): LedgerExportRow[] => [
      p.row,
      ...(splitsOf.get(p.id) ?? []).sort((a, b) => a.id - b.id).map(exportRow),
    ]);
    const fx = await this.fx.context(scope, statements);
    if (!fx.anyForeign) return out;
    // Foreign rows carry their rate and home amount; each foreign statement ends with its
    // revaluation row (0 in its currency, the home difference to Exchange Gain or Loss).
    const entries: FxEntry[] = [];
    const converted = out.map((r) => {
      const id = r.statementId!;
      if (!fx.isForeign(id)) return r;
      const { home, rate } = fx.convert(
        id,
        ISO(r.postingDate ?? r.pendingDate) || null,
        r.amount,
      );
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
    const revalued = new Map(
      fx.revaluations(entries).map((f) => [f.statementId, f]),
    );
    const lastOf = new Map(converted.map((r, i) => [r.statementId!, i]));
    return converted.flatMap((r, i): LedgerExportRow[] => {
      const f = revalued.get(r.statementId!);
      if (!f || lastOf.get(r.statementId!) !== i) return [r];
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

  async excel(
    rows: LedgerExportRow[],
    customerName: string,
    custom?: ExportCustomColumns,
  ): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'CYG Finance';
    const ws = wb.addWorksheet('Ledger', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    ws.columns = [
      { header: 'ID', key: 'id', width: 9 },
      // step8 (2026-11-11, user's rule): the posting date is THE date — first.
      {
        header: 'Posting date',
        key: 'postingDate',
        width: 14,
        style: { numFmt: 'yyyy-mm-dd' },
      },
      {
        header: 'Pending date',
        key: 'pendingDate',
        width: 14,
        style: { numFmt: 'yyyy-mm-dd' },
      },
      { header: 'Name', key: 'name', width: 24 },
      { header: 'Description', key: 'description', width: 46 },
      { header: 'Product', key: 'product', width: 20 },
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
    // Foreign statements: the currency, the day's rate and the amount in the home currency.
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
    // step8: the customer's own columns, after the fixed ones.
    const customKeys = (custom?.headers ?? []).map((_, i) => `custom${i}`);
    if (custom) {
      ws.columns = [
        ...ws.columns,
        ...custom.headers.map((h, i) => ({
          header: h,
          key: customKeys[i],
          width: Math.min(30, Math.max(12, h.length + 4)),
        })),
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
      // Cells are matched to the columns by key; `statementId` has no column.
      const { tax, split, rowId: _rowId, ...cells } = r;
      const own = Object.fromEntries(
        customCellsOf(r, custom).map((v, i) => [customKeys[i], v]),
      );
      // A home-currency row's home amount is its amount.
      const row = ws.addRow(
        foreign
          ? { ...cells, ...own, homeAmount: cells.homeAmount ?? cells.amount }
          : { ...cells, ...own },
      );
      if (tax) row.font = { italic: true, color: { argb: 'FF8A8F98' } };
      else if (split) row.font = { color: { argb: 'FF5B6470' } };
    }
    const count = rows.filter((r) => !r.tax && !r.split).length;
    const total = ws.addRow({
      description: `Net change (${count} transactions)`,
      amount: netOf(rows),
      ...(foreign && {
        homeAmount: netOf(
          rows.map((r) => ({ amount: r.homeAmount ?? r.amount })),
        ),
      }),
    });
    total.font = { bold: true };
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: ws.columns.length },
    };
    wb.title = `${customerName} — ledger`;
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  pdf(
    rows: LedgerExportRow[],
    customerName: string,
    custom?: ExportCustomColumns,
  ): Promise<Buffer> {
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

      // step8: posting date first (THE date); the customer's own columns after the fixed
      // ones, every width scaled so the table still fits the page.
      const fixed: Array<{ label: string; width: number; align?: 'right' }> = [
        { label: 'Posting', width: 56 },
        { label: 'Pending', width: 56 },
        { label: 'Name', width: 90 },
        { label: 'Description', width: 136 },
        { label: 'Product', width: 70 },
        { label: 'Amount', width: 66, align: 'right' as const },
        { label: 'Debit', width: 114 },
        { label: 'Credit', width: 114 },
        { label: 'Statement', width: 88 },
      ];
      const wide = [
        ...fixed,
        ...(custom?.headers ?? []).map((label) => ({
          label,
          width: 70,
          align: undefined as 'right' | undefined,
        })),
      ];
      const fit =
        (doc.page.width - doc.page.margins.left - doc.page.margins.right) /
        wide.reduce((n, c) => n + c.width, 0);
      const cols = wide.map((c) => ({
        ...c,
        width: c.width * Math.min(1, fit),
      }));
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
          `${customerName}  ·  ${period}  ·  ${rows.filter((r) => !r.tax && !r.split).length} transactions  ·  generated ${ISO(new Date())}`,
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
          ISO(r.postingDate),
          ISO(r.pendingDate),
          r.name,
          r.description,
          r.product ?? '',
          MONEY(r.amount),
          r.debitAccount,
          r.creditAccount,
          r.statement,
          ...customCellsOf(r, custom),
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
