import { NextRequest, NextResponse } from 'next/server';
import { listModels, createModel } from '@/lib/model-registry';

export async function GET() {
  try {
    const models = await listModels();
    return NextResponse.json({ models });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown model error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const model = await createModel(body);
    return NextResponse.json(model, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown model error';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
