import { NextResponse } from 'next/server';
import type { BatchWorkflow } from '@/lib/batch-workflow-types';

const STORAGE_KEY = 'batch-workflows';

function loadWorkflows(): BatchWorkflow[] {
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as BatchWorkflow[];
    } catch {
      // ignore
    }
  }
  return [];
}

function saveWorkflows(workflows: BatchWorkflow[]) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workflows));
  }
}

export async function GET() {
  return NextResponse.json(loadWorkflows());
}

export async function POST(request: Request) {
  const body = await request.json();
  const workflows = loadWorkflows();
  const newWorkflow: BatchWorkflow = {
    ...body,
    id: `wf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  workflows.push(newWorkflow);
  saveWorkflows(workflows);
  return NextResponse.json(newWorkflow, { status: 201 });
}

export async function PUT(request: Request) {
  const body = await request.json();
  const workflows = loadWorkflows();
  const idx = workflows.findIndex((w) => w.id === body.id);
  if (idx < 0) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  workflows[idx] = { ...workflows[idx], ...body, updatedAt: Date.now() };
  saveWorkflows(workflows);
  return NextResponse.json(workflows[idx]);
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }
  const workflows = loadWorkflows().filter((w) => w.id !== id);
  saveWorkflows(workflows);
  return NextResponse.json({ ok: true });
}
