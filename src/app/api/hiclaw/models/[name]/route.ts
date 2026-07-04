import { NextRequest, NextResponse } from 'next/server';
import { getModel, updateModel, deleteModel } from '@/lib/model-registry';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  try {
    const model = await getModel(decodeURIComponent(name));
    if (!model) {
      return NextResponse.json({ error: 'Model not found' }, { status: 404 });
    }
    return NextResponse.json(model);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown model error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  try {
    const body = await request.json();
    const model = await updateModel(decodeURIComponent(name), body);
    if (!model) {
      return NextResponse.json({ error: 'Model not found' }, { status: 404 });
    }
    return NextResponse.json(model);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown model error';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  try {
    const ok = await deleteModel(decodeURIComponent(name));
    if (!ok) {
      return NextResponse.json({ error: 'Model not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown model error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
