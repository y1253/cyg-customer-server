import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AiContact } from '@prisma/client';
import { toE164 } from '../customer-auth/phone-number.util';
import { PrismaService } from '../prisma/prisma.service';

/** A contact as the Contacts tab and the assistant see it. */
export interface ContactView {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  note: string | null;
  lastContactedAt: Date | null;
  createdAt: Date;
}

export interface ContactInput {
  name?: string;
  phone?: string | null;
  email?: string | null;
  note?: string | null;
}

/** A reply from a contact within this long of the AI's call / text is passed to the customer. */
export const CONTACT_REPLY_WINDOW_MS = 72 * 3600_000;

export function toContactView(c: AiContact): ContactView {
  return {
    id: c.id,
    name: c.name,
    phone: c.phoneE164,
    email: c.email,
    note: c.note,
    lastContactedAt: c.lastContactedAt,
    createdAt: c.createdAt,
  };
}

/**
 * step12c: the people the AI calls or texts for a customer ("call 514… and tell him…" — the
 * AI asks the name and saves it, so "call John" works next time). The customer sees and
 * edits them on the Contacts tab. Per customer, not per book. Soft-deleted.
 */
@Injectable()
export class AiContactsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(customerId: number): Promise<ContactView[]> {
    const rows = await this.prisma.aiContact.findMany({
      where: { customerId, deletedAt: null },
      orderBy: { name: 'asc' },
    });
    return rows.map(toContactView);
  }

  async get(customerId: number, id: number): Promise<AiContact> {
    const c = await this.prisma.aiContact.findFirst({
      where: { id, customerId, deletedAt: null },
    });
    if (!c) throw new NotFoundException('Contact not found');
    return c;
  }

  /** The customer's live contact on this phone (E.164), if any. */
  byPhone(customerId: number, phoneE164: string): Promise<AiContact | null> {
    return this.prisma.aiContact.findFirst({
      where: { customerId, phoneE164, deletedAt: null },
      orderBy: { id: 'asc' },
    });
  }

  async create(customerId: number, input: ContactInput): Promise<ContactView> {
    const data = this.clean(input, true);
    if (data.phoneE164) {
      const same = await this.byPhone(customerId, data.phoneE164);
      if (same) {
        throw new BadRequestException(
          `${same.name} already has this phone number`,
        );
      }
    }
    const row = await this.prisma.aiContact.create({
      data: { customerId, name: data.name!, ...data },
    });
    return toContactView(row);
  }

  async update(
    customerId: number,
    id: number,
    input: ContactInput,
  ): Promise<ContactView> {
    await this.get(customerId, id);
    const data = this.clean(input, false);
    if (data.phoneE164) {
      const same = await this.byPhone(customerId, data.phoneE164);
      if (same && same.id !== id) {
        throw new BadRequestException(
          `${same.name} already has this phone number`,
        );
      }
    }
    const row = await this.prisma.aiContact.update({
      where: { id },
      data,
    });
    return toContactView(row);
  }

  async remove(customerId: number, id: number): Promise<void> {
    await this.get(customerId, id);
    await this.prisma.aiContact.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * The assistant's save_contact: a contact on the same phone is renamed / filled in, else
   * one is created.
   */
  async save(customerId: number, input: ContactInput): Promise<ContactView> {
    const phone = input.phone ? toE164(input.phone) : null;
    const existing = phone ? await this.byPhone(customerId, phone) : null;
    return existing
      ? this.update(customerId, existing.id, input)
      : this.create(customerId, input);
  }

  /** The AI just called / texted this contact — their replies reach the customer for 72 h. */
  async touched(id: number): Promise<void> {
    await this.prisma.aiContact.update({
      where: { id },
      data: { lastContactedAt: new Date() },
    });
  }

  private clean(
    input: ContactInput,
    creating: boolean,
  ): {
    name?: string;
    phoneE164?: string | null;
    email?: string | null;
    note?: string | null;
  } {
    const out: {
      name?: string;
      phoneE164?: string | null;
      email?: string | null;
      note?: string | null;
    } = {};
    if (input.name !== undefined) {
      const name = input.name.trim().slice(0, 120);
      if (!name) throw new BadRequestException('A contact needs a name');
      out.name = name;
    } else if (creating) {
      throw new BadRequestException('A contact needs a name');
    }
    if (input.phone !== undefined) {
      const raw = input.phone?.trim() || null;
      const e164 = raw ? toE164(raw) : null;
      if (raw && !e164) {
        throw new BadRequestException(
          'Enter a valid phone number (with the country code if outside Canada / the US)',
        );
      }
      out.phoneE164 = e164;
    }
    if (input.email !== undefined) {
      out.email = input.email?.trim().toLowerCase() || null;
    }
    if (input.note !== undefined) out.note = input.note?.trim() || null;
    return out;
  }
}
