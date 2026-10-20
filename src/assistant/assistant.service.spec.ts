import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { ExecutionContext } from '@nestjs/common';
import type { AiConversation, AiMessage } from '@prisma/client';
import type { OpenAiClient } from '../ai/openai.client';
import type { AttachmentsService } from '../bookkeeping/attachments.service';
import type { PrismaService } from '../prisma/prisma.service';
import {
  AssistantService,
  FAILED_REPLY,
  MAX_TOOL_ROUNDS,
} from './assistant.service';
import { AssistantTools, NOT_UNDERSTOOD_WARNING } from './assistant-tools';
import { IntakeAgentGuard } from './intake-agent.guard';
import { IntakeAgentService, NOT_DELIVERED } from './intake-agent.service';
import { RulesService } from './rules.service';

const config = (env: Record<string, string>) =>
  ({ get: (k: string) => env[k] }) as unknown as ConfigService;

function fakePrisma() {
  const messages: AiMessage[] = [];
  let nextId = 1;
  const conversations: AiConversation[] = [];
  const prisma = {
    messages,
    conversations,
    aiMessage: {
      findMany: jest.fn(({ where }: { where: { conversationId?: number } }) =>
        messages.filter(
          (m) =>
            !where.conversationId || m.conversationId === where.conversationId,
        ),
      ),
      create: jest.fn(({ data }: { data: Partial<AiMessage> }) => {
        const row = {
          id: nextId++,
          createdAt: new Date(),
          warning: null,
          actions: null,
          attachmentIds: null,
          ...data,
        } as AiMessage;
        messages.push(row);
        return row;
      }),
      count: jest.fn(() => messages.filter((m) => m.role === 'USER').length),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    aiConversation: {
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: number };
          data: Partial<AiConversation>;
        }) => {
          const c = conversations.find((x) => x.id === where.id)!;
          Object.assign(c, data);
          return c;
        },
      ),
      create: jest.fn(({ data }: { data: Partial<AiConversation> }) => {
        const c = {
          id: conversations.length + 1,
          attachmentId: null,
          peer: null,
          awaitingBook: false,
          bookChosen: false,
          title: null,
          lastMessageAt: new Date(),
          createdAt: new Date(),
          companyId: null,
          ...data,
        } as AiConversation;
        conversations.push(c);
        return c;
      }),
      findFirst: jest.fn(
        ({ where }: { where: Partial<AiConversation> }) =>
          [...conversations]
            .reverse()
            .find(
              (c) =>
                (where.customerId === undefined ||
                  c.customerId === where.customerId) &&
                (where.channel === undefined || c.channel === where.channel) &&
                (where.peer === undefined || c.peer === where.peer),
            ) ?? null,
      ),
    },
    company: {
      findFirst: jest.fn(() => ({ businessName: 'ABC Inc' })),
      findMany: jest.fn(
        () => [] as Array<{ id: number; businessName: string }>,
      ),
    },
    transactionAttachment: { updateMany: jest.fn(() => ({ count: 2 })) },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return prisma;
}

function setup(
  replies: Array<{
    content: string | null;
    toolCalls: Array<{ id: string; name: string; arguments: string }>;
  }>,
  env = { AI_ASSISTANT: '1' },
) {
  const prisma = fakePrisma();
  const openai = {
    chatMessages: jest.fn(
      () => replies.shift() ?? { content: 'final', toolCalls: [] },
    ),
    chat: jest.fn(),
  } as unknown as OpenAiClient & { chatMessages: jest.Mock; chat: jest.Mock };
  const tools = {
    run: jest.fn((name: string, args: string) =>
      name === 'attach_receipt'
        ? {
            content: '{"ok":true}',
            action: { tool: name, ok: true, summary: 'Attached' },
            ...((JSON.parse(args) as { understood?: boolean }).understood ===
              false && {
              warning: NOT_UNDERSTOOD_WARNING,
            }),
          }
        : { content: '[]' },
    ),
  } as unknown as AssistantTools & { run: jest.Mock };
  const rules = {
    promptBlock: jest.fn(() => ''),
  } as unknown as RulesService;
  const attachments = {} as AttachmentsService;
  const service = new AssistantService(
    prisma as unknown as PrismaService,
    config(env),
    openai,
    tools,
    rules,
    attachments,
  );
  return { prisma, openai, tools, service };
}

const call = (name: string, args: unknown, id = 'c') => ({
  id,
  name,
  arguments: JSON.stringify(args),
});

describe('AssistantService', () => {
  it('runs tools on the conversation book, stores both messages with the actions and warning', async () => {
    const { service, tools, prisma } = setup([
      {
        content: null,
        toolCalls: [
          call('attach_receipt', {
            attachmentId: 1,
            transactionId: 2,
            understood: false,
          }),
        ],
      },
      { content: 'Filed it.', toolCalls: [] },
    ]);
    const res = await service.chat(
      { customerId: 7, companyId: 3 },
      'it is the Amazon charge',
    );
    expect(tools.run).toHaveBeenCalledWith(
      'attach_receipt',
      expect.any(String),
      {
        scope: { customerId: 7, companyId: 3 },
        messageId: res.message.id,
      },
    );
    expect(res.reply.text).toBe('Filed it.');
    expect(res.reply.actions).toEqual([
      { tool: 'attach_receipt', ok: true, summary: 'Attached' },
    ]);
    expect(res.reply.warning).toBe(NOT_UNDERSTOOD_WARNING);
    expect(prisma.messages.map((m) => [m.role, m.companyId])).toEqual([
      ['USER', 3],
      ['ASSISTANT', 3],
    ]);
  });

  it(`stops calling tools after ${MAX_TOOL_ROUNDS} rounds and asks for an answer without tools`, async () => {
    const loop = Array.from({ length: 20 }, (_, i) => ({
      content: null,
      toolCalls: [call('list_rules', {}, `c${i}`)],
    }));
    const { service, openai } = setup(loop);
    await service.chat({ customerId: 7, companyId: null }, 'loop forever');
    expect(openai.chatMessages).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS + 1);
    const calls = openai.chatMessages.mock.calls as Array<
      [{ tools?: unknown }]
    >;
    const last = calls[MAX_TOOL_ROUNDS][0];
    expect(last.tools).toBeUndefined();
  });

  it('apologises instead of throwing when the AI fails', async () => {
    const { service, openai } = setup([]);
    openai.chatMessages.mockRejectedValueOnce(new Error('down'));
    const res = await service.chat({ customerId: 7, companyId: null }, 'hello');
    expect(res.reply.text).toBe(FAILED_REPLY);
  });

  it('refuses when the assistant is off', async () => {
    const { service } = setup([], { AI_ASSISTANT: '0' });
    await expect(
      service.chat({ customerId: 7, companyId: null }, 'hi'),
    ).rejects.toThrow(/not turned on/);
  });
});

describe('AssistantTools', () => {
  it('refuses an unknown tool and bad JSON without throwing', async () => {
    const tools = new AssistantTools(
      ...(Array.from({ length: 10 }, () => ({})) as ConstructorParameters<
        typeof AssistantTools
      >),
    );
    const ctx = { scope: { customerId: 1, companyId: null }, messageId: null };
    expect((await tools.run('drop_database', '{}', ctx)).content).toContain(
      'unknown tool',
    );
    expect((await tools.run('list_rules', '{oops', ctx)).content).toContain(
      'not valid JSON',
    );
  });

  it('reports a failed write as a failed action', async () => {
    const attachments = {
      setTransaction: jest
        .fn()
        .mockRejectedValue(new Error('still being read')),
    };
    const deps = Array.from({ length: 10 }, () => ({})) as unknown[];
    deps[5] = attachments;
    const tools = new AssistantTools(
      ...(deps as ConstructorParameters<typeof AssistantTools>),
    );
    const out = await tools.run(
      'attach_receipt',
      JSON.stringify({ attachmentId: 1, transactionId: 2, understood: true }),
      { scope: { customerId: 1, companyId: null }, messageId: null },
    );
    expect(out.action).toMatchObject({ tool: 'attach_receipt', ok: false });
  });
});

describe('RulesService', () => {
  it("reads only this book's own rules plus ACTIVE firm rules", async () => {
    const prisma = {
      aiRule: {
        findMany: jest.fn(() => [{ text: 'firm rule', topic: 'GENERAL' }]),
      },
      customerAiRule: {
        findMany: jest.fn(() => [{ text: 'own rule', topic: 'GENERAL' }]),
      },
    };
    const block = await new RulesService(
      prisma as unknown as PrismaService,
    ).promptBlock({
      customerId: 7,
      companyId: 3,
    });
    expect(prisma.customerAiRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { customerId: 7, companyId: 3, deletedAt: null },
      }),
    );
    expect(prisma.aiRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'ACTIVE', deletedAt: null } }),
    );
    expect(block.indexOf('own rule')).toBeLessThan(block.indexOf('firm rule'));
  });

  it('never throws — a rules outage gives no block', async () => {
    const prisma = {
      aiRule: { findMany: jest.fn().mockRejectedValue(new Error('db')) },
      customerAiRule: { findMany: jest.fn(() => []) },
    };
    await expect(
      new RulesService(prisma as unknown as PrismaService).promptBlock({
        customerId: 1,
        companyId: null,
      }),
    ).resolves.toBe('');
  });
});

describe('IntakeAgentService', () => {
  function intake(
    companies: Array<{ id: number; businessName: string }>,
    kind = 'MESSAGE',
    env = { AI_ASSISTANT: '1' },
  ) {
    const s = setup(
      [{ content: 'You spent $120 in March.', toolCalls: [] }],
      env,
    );
    s.prisma.company.findMany.mockReturnValue(companies);
    (s.openai.chat as jest.Mock).mockResolvedValue(JSON.stringify({ kind }));
    const agent = new IntakeAgentService(
      s.prisma as unknown as PrismaService,
      config(env),
      s.openai,
      s.service,
    );
    return { ...s, agent };
  }
  const msg = (text: string | null, attachmentIds: number[] = []) => ({
    channel: 'SMS' as const,
    peer: '+15145550001',
    text,
    attachmentIds,
  });

  it('with the assistant off, behaves exactly as before', async () => {
    const { agent } = intake([], 'MESSAGE', { AI_ASSISTANT: '0' });
    expect(await agent.agent(7, msg('hi'))).toEqual({
      reply: null,
      fileText: true,
      companyId: null,
    });
    expect(await agent.route(7, 'SMS', '+1')).toEqual({
      companyId: null,
      awaitingBook: false,
    });
  });

  it('answers a question with the assistant and does not file it', async () => {
    const { agent } = intake([]);
    const res = await agent.agent(7, msg('what did I spend in March?'));
    expect(res).toEqual({
      reply: 'You spent $120 in March.',
      fileText: false,
      companyId: null,
    });
  });

  it('files a receipt note and confirms it', async () => {
    const { agent } = intake([], 'RECEIPT_NOTE');
    const res = await agent.agent(7, msg('paid Walmart $23'));
    expect(res.fileText).toBe(true);
    expect(res.reply).toMatch(/file that/);
  });

  it('asks which books, then moves the undecided files to the chosen one', async () => {
    const { agent, prisma } = intake([{ id: 3, businessName: 'ABC Inc' }]);
    const first = await agent.agent(7, msg(null, [41]));
    expect(first.reply).toContain('1 Personal, 2 ABC Inc');
    expect(first.companyId).toBeNull();
    expect(await agent.route(7, 'SMS', '+15145550001')).toEqual({
      companyId: null,
      awaitingBook: true,
    });

    const answer = await agent.agent(7, msg('2'));
    expect(answer.companyId).toBe(3);
    expect(answer.reply).toContain('ABC Inc');
    const moved = prisma.transactionAttachment.updateMany.mock
      .calls as unknown as Array<
      [{ where: Record<string, unknown>; data: unknown }]
    >;
    expect(moved[0][0].data).toEqual({ companyId: 3 });
    expect(moved[0][0].where).toMatchObject({
      customerId: 7,
      companyId: null,
      sourcePhone: '+15145550001',
    });
    expect(await agent.route(7, 'SMS', '+15145550001')).toEqual({
      companyId: 3,
      awaitingBook: false,
    });
  });

  it('marks the reply NOT delivered when the phone opted out (STOP)', async () => {
    const { agent, prisma } = intake([]);
    prisma.aiMessage.findFirst.mockResolvedValue({ id: 55, warning: null });
    const res = await agent.agent(7, { ...msg('hi'), deliverable: false });
    expect(res.reply).toBe('You spent $120 in March.');
    expect(prisma.aiMessage.update).toHaveBeenCalledWith({
      where: { id: 55 },
      data: { warning: NOT_DELIVERED },
    });
  });

  it('leaves a deliverable reply alone', async () => {
    const { agent, prisma } = intake([]);
    await agent.agent(7, msg('hi'));
    expect(prisma.aiMessage.update).not.toHaveBeenCalled();
  });
});

describe('IntakeAgentGuard', () => {
  const secret = 'test-secret';
  const guard = () =>
    new IntakeAgentGuard(
      { getOrThrow: () => secret } as unknown as ConfigService,
      {
        customer: { findFirst: jest.fn(() => ({ id: 7 })) },
      } as unknown as PrismaService,
    );
  const ctx = (token: string) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ headers: { authorization: `Bearer ${token}` } }),
      }),
    }) as unknown as ExecutionContext;
  const sign = (payload: object) => new JwtService({ secret }).sign(payload);

  it('accepts an intake-agent token', async () => {
    await expect(
      guard().canActivate(ctx(sign({ typ: 'intake-agent', sub: 7 }))),
    ).resolves.toBe(true);
  });

  it.each(['customer', 'staff-book'])('refuses a %s token', async (typ) => {
    await expect(
      guard().canActivate(ctx(sign({ typ, sub: 7, companyId: 3 }))),
    ).rejects.toThrow();
  });
});
