import { NextResponse } from 'next/server';

import { hostSchema } from '@/config/hosts';
import { runCommand } from '@/server/commandRunner';

export async function POST(request: Request) {
  const payload = await request.json();
  const result = hostSchema.safeParse(payload);
  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid host payload', details: result.error.format() },
      { status: 400 },
    );
  }

  try {
    await runCommand(result.data, 'echo gpu-watcher-ssh-test');
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 },
    );
  }
}
