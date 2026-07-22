import { NextResponse } from 'next/server';
import { callHigressConsole, getHigressConsoleURL } from '../../../higress/proxy-helper';

// Auto-configure Higress AI gateway: create consumer + AI route
// This resolves the Envoy listener warming issue by ensuring the key-auth
// WASM plugin config gets pushed.
export async function POST() {
  const consoleUrl = getHigressConsoleURL();

  const adminUser = process.env.AGENTTEAMS_ADMIN_USER;
  const adminPassword = process.env.AGENTTEAMS_ADMIN_PASSWORD;

  // Refuse to operate without explicitly configured admin credentials.
  // Never fall back to hardcoded defaults to avoid unauthorized gateway
  // reconfiguration when the deployer did not set the env vars.
  if (!adminUser || !adminPassword) {
    return NextResponse.json(
      { error: 'AGENTTEAMS_ADMIN_USER and AGENTTEAMS_ADMIN_PASSWORD must be configured' },
      { status: 500 }
    );
  }

  try {
    // Step 1: Login to get session cookie
    const { response: loginRes } = await callHigressConsole('/session/login', {
      method: 'POST',
      body: {
        username: adminUser,
        password: adminPassword,
      },
      consoleUrl,
    });

    if (!loginRes.ok) {
      return NextResponse.json(
        { error: 'Failed to login to Higress Console' },
        { status: 502 }
      );
    }

    // Extract session cookie
    const cookies = loginRes.headers.getSetCookie();
    const cookieStr = cookies.map((c) => c.split(';')[0]).join('; ');

    // Step 2: Create a consumer (triggers key-auth ECDS push)
    const { response: consumerRes, body: consumerBody } = await callHigressConsole(
      '/v1/consumers',
      {
        method: 'POST',
        body: {
          name: 'dashboard-admin',
          credentials: [
            {
              name: 'dashboard-key',
              keys: ['Authorization'],
            },
          ],
        },
        cookie: cookieStr,
        consoleUrl,
      }
    );

    // 409 = already exists, that's fine
    const consumerOk = consumerRes.ok || consumerRes.status === 409;

    // Step 3: Create AI route pointing to openai-compat provider
    const { response: routeRes, body: routeBody } = await callHigressConsole(
      '/v1/ai/routes',
      {
        method: 'POST',
        body: {
          name: 'agentteams-default',
          domains: [],
          pathPredicate: {
            matchType: 'PRE',
            matchValue: '/v1/chat/completions',
            caseSensitive: false,
          },
          upstreams: [
            {
              provider: 'openai-compat',
              weight: 100,
              modelMapping: {},
            },
          ],
          authConfig: {
            enabled: true,
            allowedCredentialTypes: ['key-auth'],
          },
        },
        cookie: cookieStr,
        consoleUrl,
      }
    );

    const routeOk = routeRes.ok || routeRes.status === 409;

    return NextResponse.json({
      success: consumerOk && routeOk,
      consumer: { ok: consumerOk, status: consumerRes.status, body: consumerBody },
      route: { ok: routeOk, status: routeRes.status, body: routeBody },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
