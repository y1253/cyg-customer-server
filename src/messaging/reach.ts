import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * step12c: every way a customer can reach the firm's AI RIGHT NOW (user's request: "if
 * calling AI option is on it should also say the calling option, same with email"). Read
 * live, so the site, the AI and the scheduled messages only ever offer what works.
 */
export interface FirmReach {
  /** Receipt numbers that take texts, E.164, oldest first. */
  numbers: string[];
  /** The subset that also takes WhatsApp. */
  whatsapp: string[];
  /** Calling a receipt number reaches the AI (the admin's switch, SignalWire, OpenAI). */
  voice: boolean;
  /** The customer inbox address, or null when none is connected. */
  email: string | null;
}

export async function firmReach(
  prisma: PrismaService,
  config: ConfigService,
): Promise<FirmReach> {
  const env = (k: string) => !!config.get<string>(k)?.trim();
  const [numbers, inbox, voice] = await Promise.all([
    prisma.intakeNumber.findMany({
      where: { releasedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { phoneNumber: true, whatsappStatus: true },
    }),
    prisma.customerInboxAccount.findFirst({
      orderBy: { id: 'desc' },
      select: { emailAddress: true },
    }),
    prisma.customerVoiceSettings
      .findUnique({ where: { singleton: 'GLOBAL' }, select: { enabled: true } })
      .catch(() => null),
  ]);
  return {
    numbers: numbers.map((n) => n.phoneNumber),
    whatsapp: numbers
      .filter((n) => n.whatsappStatus === 'CONNECTED')
      .map((n) => n.phoneNumber),
    voice:
      !!voice?.enabled &&
      numbers.length > 0 &&
      env('SIGNALWIRE_PROJECT_ID') &&
      env('SIGNALWIRE_API_TOKEN') &&
      env('SIGNALWIRE_SPACE_URL') &&
      env('OPENAI_API_KEY'),
    email: inbox?.emailAddress ?? null,
  };
}

/** "text, WhatsApp or call +1 855…, or email ai@…" — the ways, in words. Pure. */
export function reachWords(r: FirmReach): string | null {
  if (!r.numbers.length && !r.email) return null;
  const parts: string[] = [];
  if (r.numbers.length) {
    const how = [
      'text',
      ...(r.whatsapp.length ? ['WhatsApp'] : []),
      ...(r.voice ? ['call'] : []),
    ];
    const verbs =
      how.length > 1
        ? `${how.slice(0, -1).join(', ')} or ${how[how.length - 1]}`
        : how[0];
    parts.push(`${verbs} ${r.numbers[0]}`);
  }
  if (r.email) parts.push(`email ${r.email}`);
  return parts.join(', or ');
}
