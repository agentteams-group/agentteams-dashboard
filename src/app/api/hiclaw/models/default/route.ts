import { NextRequest, NextResponse } from 'next/server';
import { getDefaultModel, setDefaultModel } from '@/lib/model-registry';

export async function GET() {
  try {
    const model = await getDefaultModel();
    return NextResponse.json(model);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown model error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const name = typeof body === 'string' ? body : body.name;
    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    const model = await setDefaultModel(name);
    if (!model) {
      return NextResponse.json({ error: 'Model not found' }, { status: 404 });
    }
    return NextResponse.json(model);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown model error';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
