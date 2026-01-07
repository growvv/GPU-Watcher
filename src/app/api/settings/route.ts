import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  getRuntimeConfig,
  updateRuntimeConfig,
} from '@/config/runtime';

const updateSchema = z.object({
  pollIntervalMs: z.number().int().positive().optional(),
  idleWindow: z.number().int().min(1).optional(),
  idleThreshold: z.number().min(0).max(1).optional(),
  chartWindowHours: z.number().int().min(1).max(168).optional(),
  pinnedHosts: z.array(z.string()).optional(),
  hiddenHosts: z.array(z.string()).optional(),
  telegram: z
    .object({
      botToken: z.string().optional(),
      chatId: z.string().optional(),
      disableNotifications: z.boolean().optional(),
    })
    .optional(),
});

export async function GET() {
  const config = getRuntimeConfig();
  return NextResponse.json({
    settings: {
      pollIntervalMs: config.pollIntervalMs,
      idleWindow: config.idleWindow,
      idleThreshold: config.idleThreshold,
      chartWindowHours: config.chartWindowHours,
      pinnedHosts: config.pinnedHosts ?? [],
      hiddenHosts: config.hiddenHosts ?? [],
      telegram: {
        chatId: config.telegram.chatId ?? null,
        hasToken: Boolean(config.telegram.botToken),
        disableNotifications: Boolean(
          config.telegram.disableNotifications,
        ),
      },
    },
  });
}

export async function POST(request: Request) {
  const payload = await request.json();
  const result = updateSchema.safeParse(payload);
  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: result.error.format() },
      { status: 400 },
    );
  }

  const patch = { ...result.data };
  if (patch.telegram) {
    patch.telegram = {
      ...patch.telegram,
      botToken:
        patch.telegram.botToken && patch.telegram.botToken.trim() !== ''
          ? patch.telegram.botToken
          : undefined,
      chatId:
        patch.telegram.chatId && patch.telegram.chatId.trim() !== ''
          ? patch.telegram.chatId
          : undefined,
    };
  }

  const updated = updateRuntimeConfig(patch);

  return NextResponse.json({
    settings: {
      pollIntervalMs: updated.pollIntervalMs,
      idleWindow: updated.idleWindow,
      idleThreshold: updated.idleThreshold,
      chartWindowHours: updated.chartWindowHours,
      pinnedHosts: updated.pinnedHosts ?? [],
      hiddenHosts: updated.hiddenHosts ?? [],
      telegram: {
        chatId: updated.telegram.chatId ?? null,
        hasToken: Boolean(updated.telegram.botToken),
        disableNotifications: Boolean(
          updated.telegram.disableNotifications,
        ),
      },
    },
  });
}
