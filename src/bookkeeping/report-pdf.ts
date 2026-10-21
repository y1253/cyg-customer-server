import PDFDocument from 'pdfkit';
import type { ReportLine, ReportsView } from './reports.util';

const BRAND = '#169F96';

const MONEY = (n: number): string =>
  n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/** "2026-09-01".."2026-09-30" → "Sep 1 – Sep 30, 2026"; open ends say so. */
export function periodLabel(from: string | null, to: string | null): string {
  const fmt = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
  if (from && to) return `${fmt(from)} – ${fmt(to)}`;
  if (to) return `Up to ${fmt(to)}`;
  if (from) return `From ${fmt(from)}`;
  return 'All dates';
}

/**
 * step11b: the financial report as a PDF — the income statement for the period and the
 * balance sheet as of its end, from the SAME `ReportsView` the website shows. Used by the
 * monthly "Financial Report" schedule (attached to the email) and the assistant's links.
 */
export function reportPdf(view: ReportsView, owner: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom;

    const ensure = (h: number) => {
      if (doc.y + h > bottom()) doc.addPage();
    };
    const heading = (text: string) => {
      ensure(40);
      doc.moveDown(0.6);
      doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(13).text(text, left);
      doc
        .moveTo(left, doc.y + 2)
        .lineTo(left + width, doc.y + 2)
        .strokeColor(BRAND)
        .lineWidth(1)
        .stroke();
      doc.moveDown(0.4);
    };
    const row = (
      label: string,
      amount: number | null,
      opts: { bold?: boolean; indent?: number; muted?: boolean } = {},
    ) => {
      ensure(16);
      const y = doc.y;
      doc
        .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(opts.muted ? 8.5 : 10)
        .fillColor(opts.muted ? '#666666' : '#222222');
      doc.text(label, left + (opts.indent ?? 0), y, {
        width: width - 120 - (opts.indent ?? 0),
      });
      const after = doc.y;
      if (amount !== null) {
        doc.text(MONEY(amount), left + width - 120, y, {
          width: 120,
          align: 'right',
        });
      }
      doc.y = Math.max(after, y + 14);
    };
    const lines = (list: ReportLine[], withNames = false) => {
      if (!list.length) row('None', null, { muted: true, indent: 12 });
      for (const l of list) {
        row(l.name, l.amount, { indent: 12 });
        if (withNames && l.byName?.length) {
          for (const n of l.byName.slice(0, 5)) {
            row(n.name, n.amount, { indent: 28, muted: true });
          }
        }
      }
    };

    doc
      .fillColor(BRAND)
      .font('Helvetica-Bold')
      .fontSize(20)
      .text('CYG Finance — Financial report', left);
    doc
      .fillColor('#333333')
      .font('Helvetica')
      .fontSize(10.5)
      .text(`${owner}  ·  ${periodLabel(view.from, view.to)}`);
    doc
      .fontSize(8.5)
      .fillColor('#777777')
      .text(`Generated ${new Date().toISOString().slice(0, 10)}`);

    const is = view.incomeStatement;
    heading('Income statement');
    row('Income', null, { bold: true });
    lines(is.income, true);
    row('Total income', is.totalIncome, { bold: true });
    doc.moveDown(0.4);
    row('Expenses', null, { bold: true });
    lines(is.expenses, true);
    row('Total expenses', is.totalExpenses, { bold: true });
    doc.moveDown(0.4);
    row(is.netIncome >= 0 ? 'Net income' : 'Net loss', is.netIncome, {
      bold: true,
    });

    const bs = view.balanceSheet;
    heading(
      `Balance sheet${bs.asOf ? ` — as of ${periodLabel(null, bs.asOf).replace('Up to ', '')}` : ''}`,
    );
    row('Assets', null, { bold: true });
    lines(bs.assets);
    row('Total assets', bs.totalAssets, { bold: true });
    doc.moveDown(0.4);
    row('Liabilities', null, { bold: true });
    lines(bs.liabilities);
    row('Total liabilities', bs.totalLiabilities, { bold: true });
    doc.moveDown(0.4);
    row('Equity', null, { bold: true });
    lines(bs.equity);
    row('Total equity', bs.totalEquity, { bold: true });
    row('Total liabilities and equity', bs.totalLiabilitiesAndEquity, {
      bold: true,
    });

    if (view.uncategorized.count > 0) {
      doc.moveDown(0.8);
      ensure(30);
      doc
        .font('Helvetica-Oblique')
        .fontSize(9)
        .fillColor('#B45309')
        .text(
          `${view.uncategorized.count} transaction${view.uncategorized.count === 1 ? '' : 's'} (${MONEY(view.uncategorized.amount)}) are still Uncategorized, so this report is not final.`,
          left,
          doc.y,
          { width },
        );
    }
    doc.end();
  });
}
