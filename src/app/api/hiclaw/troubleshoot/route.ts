import { NextRequest, NextResponse } from 'next/server';

interface LLMConfig {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
}

function getLLMConfigFromEnv(): LLMConfig {
  const provider = process.env.HICLAW_LLM_PROVIDER || 'openai-compat';
  const apiKey = process.env.HICLAW_LLM_API_KEY || '';
  const baseUrl =
    process.env.HICLAW_OPENAI_BASE_URL ||
    process.env.HICLAW_AI_GATEWAY_URL ||
    'https://api.openai.com/v1';
  const model = process.env.HICLAW_DEFAULT_MODEL || 'gpt-4';

  return { provider, apiKey, baseUrl, model };
}

function buildPrompt(component: string, symptom: string, logs?: string, infra?: unknown): string {
  let prompt = `You are an expert SRE helping diagnose an issue in the AgentTeams (HiClaw) cluster.\n\n`;
  prompt += `Affected component: ${component}\n`;
  prompt += `Symptom: ${symptom}\n\n`;
  if (logs) {
    prompt += `Recent logs:\n\`\`\`\n${logs}\n\`\`\`\n\n`;
  }
  if (infra) {
    prompt += `Infrastructure snapshot:\n\`\`\`json\n${JSON.stringify(infra, null, 2)}\n\`\`\`\n\n`;
  }
  prompt += `Please analyze the problem, identify likely root causes, and suggest concrete remediation steps. Keep the answer concise and actionable.`;
  return prompt;
}

export async function POST(request: NextRequest) {
  let body: { component?: string; symptom?: string; logs?: string; infraSnapshot?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { component = '', symptom = '', logs, infraSnapshot } = body;
  if (!component || !symptom) {
    return NextResponse.json({ error: 'component and symptom are required' }, { status: 400 });
  }

  const cfg = getLLMConfigFromEnv();
  if (!cfg.apiKey) {
    return NextResponse.json(
      { error: 'LLM API key is not configured. Set HICLAW_LLM_API_KEY.' },
      { status: 503 }
    );
  }

  const prompt = buildPrompt(component, symptom, logs, infraSnapshot);
  const chatUrl = `${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`;

  try {
    const res = await fetch(chatUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'user', content: prompt }],
        stream: true,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return NextResponse.json(
        { error: `LLM returned ${res.status}: ${text}` },
        { status: 502 }
      );
    }

    if (!res.body) {
      return NextResponse.json({ error: 'LLM returned empty stream' }, { status: 502 });
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        const reader = res.body!.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            controller.enqueue(encoder.encode(chunk));
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Stream error';
          controller.enqueue(encoder.encode(`\n\n[Error: ${message}]`));
        } finally {
          controller.close();
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown LLM error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
