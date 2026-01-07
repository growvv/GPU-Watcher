import { NextResponse } from 'next/server';
import { z } from 'zod';

import { sendTelegramTestMessage } from '@/server/telegram';

const schema = z.object({
  botToken: z.string().min(1),
  chatId: z.string().min(1),
  message: z.string().min(1),
  persist: z.boolean().optional(),
});

export async function POST(request: Request) {
  const payload = await request.json();
  const result = schema.safeParse(payload);
  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: result.error.format() },
      { status: 400 },
    );
  }

  try {
    await sendTelegramTestMessage({
      token: result.data.botToken,
      chatId: result.data.chatId,
      text: result.data.message,
      persist: result.data.persist,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 },
    );
  }
}
