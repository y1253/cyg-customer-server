import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { MailService } from '../mail/mail.service';
import {
  CONTACT_LIMIT,
  ContactService,
  buildContactEmail,
} from './contact.service';
import { CreateContactDto } from './dto/create-contact.dto';

const VALID: CreateContactDto = {
  firstName: 'Ana',
  lastName: 'Lopez',
  email: 'ana@example.com',
  phone: '514-555-0100',
  company: 'Lopez Inc',
  title: 'Owner',
  message: 'Hello',
};

function setup(env: Record<string, string> = {}) {
  const send = jest
    .fn<Promise<void>, Parameters<MailService['send']>>()
    .mockResolvedValue(undefined);
  const mail = { configured: true, send } as unknown as MailService;
  const config = { get: (k: string) => env[k] } as unknown as ConfigService;
  return { service: new ContactService(mail, config), send, mail };
}

describe('ContactService', () => {
  it('mails the firm with the visitor as reply-to', async () => {
    const { service, send } = setup();
    await service.submit(VALID, '1.1.1.1');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({
      to: 'office@cygfinance.com',
      replyTo: 'ana@example.com',
      subject: 'Website enquiry — Ana Lopez (Lopez Inc)',
    });
  });

  it('honours CONTACT_TO', async () => {
    const { service, send } = setup({ CONTACT_TO: 'leads@cygfinance.com' });
    await service.submit(VALID, '1.1.1.1');
    expect(send.mock.calls[0][0].to).toBe('leads@cygfinance.com');
  });

  it('silently drops a filled honeypot', async () => {
    const { service, send } = setup();
    await expect(
      service.submit({ ...VALID, website: 'http://spam' }, '1.1.1.1'),
    ).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it('throttles per IP, and only that IP', async () => {
    const { service } = setup();
    for (let i = 0; i < CONTACT_LIMIT; i++)
      await service.submit(VALID, '2.2.2.2');
    const err = await service.submit(VALID, '2.2.2.2').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
    await expect(service.submit(VALID, '3.3.3.3')).resolves.toBeUndefined();
  });

  it('503s when SMTP is not configured', async () => {
    const { service, mail } = setup();
    Object.defineProperty(mail, 'configured', { value: false });
    await expect(service.submit(VALID, '1.1.1.1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('503s when the send fails', async () => {
    const { service, send } = setup();
    send.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    await expect(service.submit(VALID, '1.1.1.1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

describe('buildContactEmail', () => {
  it('never lets CR/LF reach the subject', () => {
    const { subject } = buildContactEmail({
      ...VALID,
      firstName: 'Ana\r\nBcc: evil@x.com',
    });
    expect(subject).not.toMatch(/[\r\n]/);
  });

  it('escapes HTML in every value', () => {
    const { html } = buildContactEmail({
      ...VALID,
      company: '<b>Smith & Sons</b>',
      message: '<script>alert(1)</script>',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Smith &amp; Sons');
  });
});

describe('CreateContactDto', () => {
  const errorsFor = async (body: object) =>
    (await validate(plainToInstance(CreateContactDto, body))).map(
      (e) => e.property,
    );

  it('accepts a complete submission', async () => {
    expect(await errorsFor(VALID)).toEqual([]);
  });

  it('rejects a bad email and a whitespace-only required field', async () => {
    expect(
      await errorsFor({ ...VALID, email: 'nope', company: '   ' }),
    ).toEqual(expect.arrayContaining(['email', 'company']));
  });

  it('lets the message be omitted', async () => {
    const { message: _omit, ...rest } = VALID;
    void _omit;
    expect(await errorsFor(rest)).toEqual([]);
  });
});
