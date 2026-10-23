import {
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AttachmentsService } from './attachments.service';
import { BookkeepingService } from './bookkeeping.service';
import { LedgerExportService } from './export.service';
import { reportPdf } from './report-pdf';
import { ReportsService } from './reports.service';
import { bookOwnerName, legacyBook } from './books';
import type { BookScope } from './scope';

/** The claim on a file link — never a login (`CustomerJwtStrategy` wants `'customer'`). */
export const FILE_LINK_TOKEN_TYPE = 'file-link';
/** How long a link the assistant (or a scheduled message) sends keeps working. */
export const FILE_LINK_TTL_DAYS = 7;

export type FileLinkKind = 'statement' | 'attachment' | 'report' | 'ledger';

export interface FileLinkTarget {
  kind: FileLinkKind;
  /** statement / attachment id. */
  id?: number;
  /** report period (YYYY-MM-DD, either may be absent). */
  from?: string | null;
  to?: string | null;
  /** ledger: pdf (default) or xlsx. */
  format?: 'pdf' | 'xlsx';
}

interface FileLinkClaims {
  typ: string;
  sub: number;
  /** step12c: the book. */
  b?: number;
  /** Links signed before step12c: the business (null = the general book, now the default). */
  c?: number | null;
  k: FileLinkKind;
  i?: number;
  f?: string | null;
  t?: string | null;
  x?: 'pdf' | 'xlsx';
}

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * step11b: a link that opens ONE file of ONE book without signing in — sent by the AI
 * assistant ("send me my March statement") and by scheduled reports, so it works from a
 * text message. A JWT on `CUSTOMER_JWT_SECRET` with its own `typ`, naming the book and the
 * file, expiring in 7 days. Serving it re-checks that the customer, the book and the file
 * still exist, so a closed account or a deleted file stops the link at once.
 */
@Injectable()
export class FileLinkService {
  private readonly jwt: JwtService;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly bookkeeping: BookkeepingService,
    private readonly attachments: AttachmentsService,
    private readonly reports: ReportsService,
    private readonly exporter: LedgerExportService,
  ) {
    this.jwt = new JwtService({
      secret: config.getOrThrow<string>('CUSTOMER_JWT_SECRET'),
    });
  }

  private base(): string {
    return (
      this.config.get<string>('PUBLIC_BASE_URL')?.trim().replace(/\/+$/, '') ||
      'https://cygfinance.com'
    );
  }

  /** A link to one file of this book. Checks the file is the book's before signing. */
  async link(scope: BookScope, target: FileLinkTarget): Promise<string> {
    if (target.kind === 'statement') {
      await this.bookkeeping.fileInfo(scope, target.id ?? 0); // 404 / "came from the bank feed"
    } else if (target.kind === 'attachment') {
      await this.attachments.get(scope, target.id ?? 0);
    }
    const claims: FileLinkClaims = {
      typ: FILE_LINK_TOKEN_TYPE,
      sub: scope.customerId,
      b: scope.bookId,
      k: target.kind,
      ...(target.id ? { i: target.id } : {}),
      ...(target.from ? { f: target.from } : {}),
      ...(target.to ? { t: target.to } : {}),
      ...(target.format ? { x: target.format } : {}),
    };
    const token = this.jwt.sign(claims, {
      expiresIn: `${FILE_LINK_TTL_DAYS}d`,
    });
    return `${this.base()}/api/f/${token}`;
  }

  /** The file a link opens, or 404 for an expired / foreign / revoked one. */
  async open(token: string): Promise<{
    body: StreamableFile;
    filename: string;
    mimeType: string;
  }> {
    let p: FileLinkClaims;
    try {
      p = this.jwt.verify<FileLinkClaims>(token);
    } catch {
      throw new NotFoundException('This link has expired. Ask for a new one.');
    }
    if (p.typ !== FILE_LINK_TOKEN_TYPE || typeof p.sub !== 'number') {
      throw new NotFoundException('This link is not valid');
    }
    const scope = await this.liveScope(p.sub, {
      bookId: p.b ?? null,
      companyId: p.c ?? null,
    });
    switch (p.k) {
      case 'statement': {
        const f = await this.bookkeeping.file(scope, p.i ?? 0);
        return {
          body: new StreamableFile(f.stream),
          filename: f.filename,
          mimeType: 'application/pdf',
        };
      }
      case 'attachment': {
        const f = await this.attachments.file(scope, p.i ?? 0);
        return {
          body: new StreamableFile(f.stream),
          filename: f.filename,
          mimeType: f.mimeType,
        };
      }
      case 'report': {
        const view = await this.reports.reports(
          scope,
          p.f ?? null,
          p.t ?? null,
        );
        const buf = await reportPdf(view, await this.ownerName(scope));
        return {
          body: new StreamableFile(buf),
          filename: `financial-report${p.t ? `-${p.t}` : ''}.pdf`,
          mimeType: 'application/pdf',
        };
      }
      case 'ledger': {
        const rows = await this.exporter.rowsFor(scope);
        const owner = await this.ownerName(scope);
        const xlsx = p.x === 'xlsx';
        const buf = xlsx
          ? await this.exporter.excel(rows, owner)
          : await this.exporter.pdf(rows, owner);
        return {
          body: new StreamableFile(buf),
          filename: `ledger-${new Date().toISOString().slice(0, 10)}.${xlsx ? 'xlsx' : 'pdf'}`,
          mimeType: xlsx
            ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            : 'application/pdf',
        };
      }
    }
    throw new NotFoundException('This link is not valid');
  }

  /** The book still exists and is still this customer's (the BookScopeGuard rule). */
  private async liveScope(
    customerId: number,
    ref: { bookId: number | null; companyId: number | null },
  ): Promise<BookScope> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('This link is not valid');
    try {
      return await legacyBook(this.prisma, customerId, ref);
    } catch {
      throw new NotFoundException('This link is not valid');
    }
  }

  /** Whose name heads an export: the book's (the company's) name. */
  async ownerName(scope: BookScope): Promise<string> {
    return bookOwnerName(this.prisma, scope);
  }
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ] ?? c,
  );
}

/** The page a dead link answers: why, and how to get a new one. */
export function linkProblemPage(reason: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Link not available · CYG Finance</title></head>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#1f2937">
<h1 style="font-size:1.25rem">This link can't be opened</h1>
<p>${escapeHtml(reason)}</p>
<p>Links to your files work for 7 days. Ask the CYG Finance assistant for a new one, or sign in at <a href="https://cygfinance.com/login">cygfinance.com</a>.</p>
</body></html>`;
}

/**
 * `GET /api/f/:token` — the ONE unauthenticated file route: whoever holds the link (the
 * customer, on their phone) opens the file. Its own class holding nothing else, so no other
 * route is ever left unguarded by accident. `private, no-store`: a client's document.
 */
@Controller('f')
export class FileLinkController {
  constructor(private readonly links: FileLinkService) {}

  @Get(':token')
  async open(
    @Param('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile | string> {
    let f: Awaited<ReturnType<FileLinkService['open']>>;
    try {
      f = await this.links.open(token);
    } catch (err) {
      if (!(err instanceof NotFoundException)) throw err;
      // step12: a customer opens this from a text or an email — a page, not raw JSON.
      res.status(404).set({
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex',
      });
      return linkProblemPage(err.message);
    }
    res.set({
      'Content-Type': f.mimeType,
      'Content-Disposition': contentDisposition(f.filename),
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
    });
    return f.body;
  }
}
