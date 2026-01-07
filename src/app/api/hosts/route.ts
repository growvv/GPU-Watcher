import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getHosts, setHosts, hostSchema } from '@/config/hosts';

export async function GET() {
  return NextResponse.json({ hosts: getHosts() });
}

const addHostSchema = hostSchema.extend({
  id: z.string().min(1),
});

export async function POST(request: Request) {
  const payload = await request.json();
  const result = addHostSchema.safeParse(payload);
  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid host payload', details: result.error.format() },
      { status: 400 },
    );
  }

  const hosts = getHosts();
  if (hosts.some((host) => host.id === result.data.id)) {
    return NextResponse.json(
      { error: `Host ${result.data.id} already exists` },
      { status: 409 },
    );
  }

  setHosts([...hosts, result.data]);

  return NextResponse.json({ host: result.data });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const hosts = getHosts();
  if (!hosts.some((host) => host.id === id)) {
    return NextResponse.json(
      { error: `Host ${id} not found` },
      { status: 404 },
    );
  }

  setHosts(hosts.filter((host) => host.id !== id));

  return NextResponse.json({ removed: id });
}
