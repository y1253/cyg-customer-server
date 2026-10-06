import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

/**
 * Plain SMTP mail from the firm's own Google Workspace mailbox (today: the public
 * contact form).
 *
 * A copy of the internal app's `mail/mail.service.ts`, deliberately not a shared
 * package: the two apps deploy independently and share no code. Keep the transport
 * settings in step with that file — they were each paid for in production.
 *
 * `SMTP_PASS` is a Google APP password (Account → Security → App passwords), not the
 * account password. It lives in `.env` only.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  /** Configured at all? `false` means every send will throw. */
  get configured(): boolean {
    return !!this.user() && !!this.pass();
  }

  async send(opts: {
    to: string;
    subject: string;
    text: string;
    html?: string;
    /** Where a reply goes — the visitor, not our own mailbox. */
    replyTo?: string;
  }): Promise<void> {
    if (!this.configured) {
      throw new Error('SMTP_USER / SMTP_PASS are not set');
    }
    const started = Date.now();
    await this.transport().sendMail({
      from: `"${this.config.get<string>('SMTP_FROM_NAME') ?? 'CYG Finance website'}" <${this.user()}>`,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      ...(opts.html ? { html: opts.html } : {}),
      ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
    });
    // Never log the subject or body: they carry a visitor's personal details, and this
    // line lands in the pm2 log on the server.
    this.logger.log(`sent mail to ${opts.to} in ${Date.now() - started}ms`);
  }

  private user(): string {
    return (this.config.get<string>('SMTP_USER') ?? '').trim();
  }

  /** Google shows an app password in groups of four; the spaces are not part of it. */
  private pass(): string {
    return (this.config.get<string>('SMTP_PASS') ?? '').replace(/\s+/g, '');
  }

  private transport(): Transporter {
    if (!this.transporter) {
      // 587 + STARTTLS, not 465: Hetzner Cloud blocks outbound 25 AND 465 by default, so
      // on the production host 465 is a 15s connection timeout on every send. `||`
      // rather than `??` so a blank `SMTP_PORT=` falls back instead of becoming port 0.
      const port = Number(this.config.get<string>('SMTP_PORT')) || 587;
      this.transporter = nodemailer.createTransport({
        host: this.config.get<string>('SMTP_HOST') || 'smtp.gmail.com',
        port,
        secure: port === 465,
        // Without this, the STARTTLS upgrade on 587 is only opportunistic: a stripped
        // upgrade would send the app password in clear text.
        requireTLS: port !== 465,
        auth: { user: this.user(), pass: this.pass() },
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 20_000,
      });
    }
    return this.transporter;
  }
}
