import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../mail/mail.service';
import { CreateContactDto } from './dto/create-contact.dto';

/** Submissions allowed per IP inside one window. */
export const CONTACT_LIMIT = 5;
export const CONTACT_WINDOW_MS = 15 * 60_000;

const FIELDS: [keyof CreateContactDto, string][] = [
  ['firstName', 'First name'],
  ['lastName', 'Last name'],
  ['email', 'Email'],
  ['phone', 'Phone'],
  ['company', 'Company'],
  ['title', 'Title'],
];

/** One line, trimmed — anything that goes into a mail HEADER must never carry CR/LF. */
function oneLine(value: string | undefined): string {
  return (value ?? '').replace(/[\r\n]+/g, ' ').trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);
  /**
   * Per-IP submission times, in process. `/contact` is public and every accepted post
   * sends an email from the firm's own mailbox, so an unthrottled route is a way to
   * flood that inbox (and burn the mailbox's sending quota). In-memory is fine: PM2
   * runs one fork, and a restart forgetting the counts costs nothing.
   */
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async submit(dto: CreateContactDto, ip: string): Promise<void> {
    // Honeypot filled → a bot. Report success and do nothing.
    if (dto.website?.trim()) {
      this.logger.warn(`honeypot tripped from ${ip}; dropped`);
      return;
    }

    this.throttle(ip);

    if (!this.mail.configured) {
      this.logger.error(
        'contact form submitted but SMTP_USER / SMTP_PASS are not set',
      );
      throw new ServiceUnavailableException(
        'Our contact form is temporarily unavailable. Please email office@cygfinance.com.',
      );
    }

    const to =
      oneLine(this.config.get<string>('CONTACT_TO')) || 'office@cygfinance.com';
    try {
      await this.mail.send({
        to,
        replyTo: oneLine(dto.email),
        ...buildContactEmail(dto),
      });
    } catch (err) {
      // The reason only — never the visitor's details.
      this.logger.error(`contact mail failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException(
        'We could not send your message. Please try again or email office@cygfinance.com.',
      );
    }
  }

  private throttle(ip: string): void {
    const now = Date.now();
    const recent = (this.hits.get(ip) ?? []).filter(
      (t) => now - t < CONTACT_WINDOW_MS,
    );
    if (recent.length >= CONTACT_LIMIT) {
      this.hits.set(ip, recent);
      throw new HttpException(
        'Too many messages. Please try again later or email office@cygfinance.com.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    recent.push(now);
    this.hits.set(ip, recent);
    // Drop idle IPs so the map cannot grow without bound.
    if (this.hits.size > 5000) {
      for (const [key, times] of this.hits) {
        if (times.every((t) => now - t >= CONTACT_WINDOW_MS))
          this.hits.delete(key);
      }
    }
  }
}

/** Subject + plain-text and HTML bodies. Pure, so the escaping rules are testable. */
export function buildContactEmail(dto: CreateContactDto): {
  subject: string;
  text: string;
  html: string;
} {
  const name = `${oneLine(dto.firstName)} ${oneLine(dto.lastName)}`.trim();
  const company = oneLine(dto.company);
  const subject = `Website enquiry — ${name}${company ? ` (${company})` : ''}`;
  const message = (dto.message ?? '').trim();

  const text = [
    'New message from the cygfinance.com contact form.',
    '',
    ...FIELDS.map(([key, label]) => `${label}: ${oneLine(dto[key])}`),
    '',
    'Message:',
    message || '(none)',
  ].join('\n');

  const rows = FIELDS.map(
    ([key, label]) =>
      `<tr><td style="padding:4px 12px 4px 0;color:#555"><b>${label}</b></td>` +
      `<td style="padding:4px 0">${escapeHtml(oneLine(dto[key]))}</td></tr>`,
  ).join('');
  const html =
    `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">` +
    `<p>New message from the cygfinance.com contact form.</p>` +
    `<table style="border-collapse:collapse">${rows}</table>` +
    `<p style="margin-top:16px"><b>Message:</b></p>` +
    `<p style="white-space:pre-wrap">${message ? escapeHtml(message) : '<i>(none)</i>'}</p>` +
    `</div>`;

  return { subject, text, html };
}
