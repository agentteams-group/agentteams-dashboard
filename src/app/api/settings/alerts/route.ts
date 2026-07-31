import { NextRequest, NextResponse } from 'next/server';
import { loadAlertRules, saveAlertRules } from '@/lib/alert-rules';
import { updateAlertRule } from '@/lib/alert-core';
import type { AlertRule, AlertRuleRequest } from '@/lib/alert-types';

export async function GET() {
  const rules = loadAlertRules();
  return NextResponse.json({ rules });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as AlertRuleRequest;
    const rules = loadAlertRules();

    // Check for duplicates
    const duplicate = rules.find(
      (r) => r.insightType === body.insightType && r.severity === body.severity && !body.id
    );
    if (duplicate) {
      return NextResponse.json(
        { error: '规则已存在' },
        { status: 409 }
      );
    }

    const newRule: AlertRule = {
      id: `rule-${Date.now()}`,
      insightType: body.insightType,
      severity: body.severity,
      thresholds: body.thresholds ?? {},
      channels: body.channels,
      recipients: body.recipients ?? [],
      throttleMinutes: body.throttleMinutes,
      description: body.description ?? '',
      enabled: body.enabled ?? true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    rules.push(newRule);
    saveAlertRules(rules);
    updateAlertRule(newRule);

    return NextResponse.json({ rule: newRule }, { status: 201 });
  } catch {
    return NextResponse.json({ error: '无效请求' }, { status: 400 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<AlertRule> & { id: string };
    const rules = loadAlertRules();
    const index = rules.findIndex((r) => r.id === body.id);

    if (index < 0) {
      return NextResponse.json({ error: '规则不存在' }, { status: 404 });
    }

    const updated: AlertRule = {
      ...rules[index],
      ...body,
      updatedAt: Date.now(),
    };

    rules[index] = updated;
    saveAlertRules(rules);
    updateAlertRule(updated);

    return NextResponse.json({ rule: updated });
  } catch {
    return NextResponse.json({ error: '无效请求' }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: '缺少规则ID' }, { status: 400 });
  }

  const rules = loadAlertRules().filter((r) => r.id !== id);
  saveAlertRules(rules);

  return NextResponse.json({ success: true });
}
