import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { nameKeyOf } from './attachment-name.util';
import { cleanName } from './attachments.service';
import { bookScope, scopeWhere, type BookScope } from './scope';

/** step2 (2026-11-11): a subfolder inside a name's folder on the Names tab. */
export interface NameFolderView {
  id: number;
  /** The name it lives under (matched case-insensitively); '' = Unsorted. */
  nameKey: string;
  parentId: number | null;
  title: string;
}

/** The email a file came in, for "View full email". */
export interface AttachmentEmailView {
  from: string | null;
  to: string | null;
  subject: string | null;
  receivedAt: Date | null;
  text: string | null;
  html: string | null;
  /** The email itself is not kept (it came before step2) — only its words are shown. */
  partial: boolean;
  /** Every file that came in the same email (this one included). */
  files: Array<{ id: number; filename: string; mimeType: string }>;
}

/** The claim on a QR-code upload link (`POST bookkeeping/phone-upload-link`). */
export const PHONE_UPLOAD_TOKEN_TYPE = 'phone-upload';
/** The claim on this API's calls to the internal API (`POST customer-inbox/welcome`). */
export const CUSTOMER_SYSTEM_TOKEN_TYPE = 'customer-system';

export interface PhoneUploadClaims {
  typ: typeof PHONE_UPLOAD_TOKEN_TYPE;
  sub: number;
  bookId: number;
  /** Upload into this name's folder (and subfolder); absent = Unsorted, the AI files it. */
  name?: string;
  folderId?: number;
}

/** A QR link works this long — enough to scan and send a few photos. */
const PHONE_UPLOAD_TTL = '30m';
/** At most one welcome email per customer this often (pm2 fork mode: in memory). */
const WELCOME_EVERY_MS = 10 * 60_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * step2 (2026-11-11) — files live in the Names tab: subfolders, the email a file came in,
 * the QR-code upload link and the welcome email sent from the customer inbox.
 */
@Injectable()
export class NameFilesService {
  private readonly logger = new Logger(NameFilesService.name);
  private readonly jwt: JwtService;
  private readonly welcomeSent = new Map<number, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.jwt = new JwtService({
      secret: config.getOrThrow<string>('CUSTOMER_JWT_SECRET'),
    });
  }

  // ── Subfolders ────────────────────────────────────────────────────────────

  async folders(scope: BookScope): Promise<NameFolderView[]> {
    const rows = await this.prisma.nameFolder.findMany({
      where: { ...scopeWhere(scope), deletedAt: null },
      orderBy: [{ title: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, parentId: true, title: true },
    });
    return rows.map((r) => ({
      id: r.id,
      nameKey: r.name,
      parentId: r.parentId,
      title: r.title,
    }));
  }

  /** A new subfolder under `name` (null / '' = Unsorted), inside `parentId` (null = the top). */
  async createFolder(
    scope: BookScope,
    name: string | null,
    parentId: number | null,
    rawTitle: string,
  ): Promise<NameFolderView[]> {
    const title = cleanTitle(rawTitle);
    const key = name ? nameKeyOf(name) : '';
    if (parentId != null) {
      const parent = await this.folder(scope, parentId);
      if (parent.name !== key)
        throw new BadRequestException('That folder is under another name');
    }
    await this.prisma.nameFolder.create({
      data: { ...scopeWhere(scope), name: key, parentId, title },
    });
    return this.folders(scope);
  }

  async renameFolder(
    scope: BookScope,
    id: number,
    rawTitle: string,
  ): Promise<NameFolderView[]> {
    const f = await this.folder(scope, id);
    await this.prisma.nameFolder.update({
      where: { id: f.id },
      data: { title: cleanTitle(rawTitle) },
    });
    return this.folders(scope);
  }

  /** Its files and subfolders move up one level; the folder is soft-deleted. */
  async removeFolder(scope: BookScope, id: number): Promise<NameFolderView[]> {
    const f = await this.folder(scope, id);
    await this.prisma.$transaction([
      this.prisma.transactionAttachment.updateMany({
        where: { ...scopeWhere(scope), folderId: f.id },
        data: { folderId: f.parentId },
      }),
      this.prisma.nameFolder.updateMany({
        where: { ...scopeWhere(scope), parentId: f.id, deletedAt: null },
        data: { parentId: f.parentId },
      }),
      this.prisma.nameFolder.update({
        where: { id: f.id },
        data: { deletedAt: new Date() },
      }),
    ]);
    return this.folders(scope);
  }

  private async folder(scope: BookScope, id: number) {
    const f = await this.prisma.nameFolder.findFirst({
      where: { id, ...scopeWhere(scope), deletedAt: null },
    });
    if (!f) throw new NotFoundException('Folder not found');
    return f;
  }

  // ── The email a file came in ──────────────────────────────────────────────

  async email(scope: BookScope, id: number): Promise<AttachmentEmailView> {
    const a = await this.prisma.transactionAttachment.findFirst({
      where: { id, ...scopeWhere(scope), deletedAt: null },
      select: {
        id: true,
        filename: true,
        mimeType: true,
        source: true,
        sourcePhone: true,
        message: true,
        createdAt: true,
        inboxMessageId: true,
        inboxMessage: {
          select: {
            fromEmail: true,
            toEmail: true,
            subject: true,
            receivedAt: true,
            bodyText: true,
            bodyHtml: true,
          },
        },
      },
    });
    if (!a) throw new NotFoundException('Attachment not found');
    const m = a.inboxMessage;
    if (!m) {
      if (a.source !== 'EMAIL')
        throw new NotFoundException('This file did not come by email');
      return {
        from: a.sourcePhone,
        to: null,
        subject: null,
        receivedAt: a.createdAt,
        text: a.message,
        html: null,
        partial: true,
        files: [{ id: a.id, filename: a.filename, mimeType: a.mimeType }],
      };
    }
    const files = await this.prisma.transactionAttachment.findMany({
      where: {
        ...scopeWhere(scope),
        deletedAt: null,
        inboxMessageId: a.inboxMessageId,
      },
      select: { id: true, filename: true, mimeType: true },
      orderBy: { id: 'asc' },
    });
    return {
      from: m.fromEmail,
      to: m.toEmail,
      subject: m.subject,
      receivedAt: m.receivedAt,
      text: m.bodyText ?? a.message,
      html: m.bodyHtml,
      partial: m.bodyText == null && m.bodyHtml == null,
      files,
    };
  }

  // ── QR-code upload from a phone ───────────────────────────────────────────

  /** A 30-minute link a phone opens (by QR code) to send files into this book. */
  async phoneUploadLink(
    scope: BookScope,
    place: { name?: string | null; folderId?: number | null },
  ): Promise<{ url: string; expiresInMinutes: number }> {
    const name = cleanName(place.name);
    if (place.folderId != null) await this.folder(scope, place.folderId);
    const claims: PhoneUploadClaims = {
      typ: PHONE_UPLOAD_TOKEN_TYPE,
      sub: scope.customerId,
      bookId: scope.bookId,
      ...(name ? { name } : {}),
      ...(place.folderId != null ? { folderId: place.folderId } : {}),
    };
    const token = this.jwt.sign(claims, { expiresIn: PHONE_UPLOAD_TTL });
    const base = (
      this.config.get<string>('PUBLIC_BASE_URL') ?? 'https://cygfinance.com'
    ).replace(/\/+$/, '');
    return { url: `${base}/upload/${token}`, expiresInMinutes: 30 };
  }

  /**
   * The book (and place) a phone-upload token sends to; 401 when it is expired, forged, or
   * its book / customer is gone.
   */
  async phoneUploadTarget(token: string): Promise<{
    scope: BookScope;
    name: string | null;
    folderId: number | null;
    bookName: string;
  }> {
    let c: Partial<PhoneUploadClaims>;
    try {
      c = this.jwt.verify<Partial<PhoneUploadClaims>>(token);
    } catch {
      throw new UnauthorizedException(
        'This link has expired. Scan the QR code again on your computer.',
      );
    }
    if (c.typ !== PHONE_UPLOAD_TOKEN_TYPE || !c.sub || !c.bookId)
      throw new UnauthorizedException('This link is not valid.');
    const book = await this.prisma.book.findFirst({
      where: {
        id: c.bookId,
        customerId: c.sub,
        deletedAt: null,
        customer: { deletedAt: null },
      },
      select: { id: true, customerId: true, companyId: true, name: true },
    });
    if (!book) throw new UnauthorizedException('This link is not valid.');
    return {
      scope: bookScope(book),
      name: c.name ?? null,
      folderId: c.folderId ?? null,
      bookName: book.name,
    };
  }

  // ── The welcome email ─────────────────────────────────────────────────────

  /**
   * "Send a welcome email": the customer inbox (assistance@, connected by an admin in the
   * internal app) emails `to` how to send documents in. `to` is then accepted by the inbox
   * as this customer (`CustomerSenderEmail`), so replies from it are filed here.
   */
  async welcomeEmail(
    scope: BookScope,
    rawTo: string,
  ): Promise<{ ok: boolean; message: string }> {
    const to = rawTo.trim().toLowerCase();
    if (!EMAIL_RE.test(to) || to.length > 191)
      throw new BadRequestException('Type a valid email address');
    const last = this.welcomeSent.get(scope.customerId) ?? 0;
    if (Date.now() - last < WELCOME_EVERY_MS)
      throw new HttpException(
        'We just sent a welcome email — give it a few minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const [customer, book] = await Promise.all([
      this.prisma.customer.findFirst({
        where: { id: scope.customerId, deletedAt: null },
        select: { name: true, email: true },
      }),
      this.prisma.book.findUnique({
        where: { id: scope.bookId },
        select: { name: true },
      }),
    ]);
    if (!customer) throw new NotFoundException();
    if (to !== customer.email?.toLowerCase()) {
      const known = await this.prisma.customerSenderEmail.findFirst({
        where: { customerId: scope.customerId, email: to },
        select: { id: true },
      });
      if (!known)
        await this.prisma.customerSenderEmail.create({
          data: { customerId: scope.customerId, email: to },
        });
    }
    const base = (
      this.config.get<string>('INTERNAL_API_URL') ?? 'http://localhost:3000/api'
    ).replace(/\/+$/, '');
    const token = this.jwt.sign(
      { typ: CUSTOMER_SYSTEM_TOKEN_TYPE },
      { expiresIn: '2m' },
    );
    try {
      const res = await fetch(`${base}/customer-inbox/welcome`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to,
          customerName: customer.name,
          bookName: book?.name ?? null,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const body = (await res.json().catch(() => null)) as {
        from?: string;
        message?: string;
      } | null;
      if (!res.ok) {
        this.logger.warn(
          `welcome email for customer ${scope.customerId}: internal API answered ${res.status} ${body?.message ?? ''}`,
        );
        return {
          ok: false,
          message:
            res.status === 503
              ? 'Our email inbox is not connected right now — please try again later.'
              : 'We could not send the email right now — please try again later.',
        };
      }
      this.welcomeSent.set(scope.customerId, Date.now());
      return {
        ok: true,
        message: `Sent to ${to}${body?.from ? ` from ${body.from}` : ''}.`,
      };
    } catch (err) {
      this.logger.warn(
        `welcome email for customer ${scope.customerId}: internal API unreachable: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        ok: false,
        message: 'We could not send the email right now — please try again later.',
      };
    }
  }
}

function cleanTitle(raw: string): string {
  const t = raw?.replace(/\s+/g, ' ').trim().slice(0, 128);
  if (!t) throw new BadRequestException('Give the folder a name');
  return t;
}
