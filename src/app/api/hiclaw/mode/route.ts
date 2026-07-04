// GET /api/hiclaw/mode - Detect deployment mode from filesystem / env.
// Returns 'embedded' or 'k8s'. This is used as a fallback when the Controller
// API is unreachable at startup.
import { NextResponse } from 'next/server';
import fs from 'fs';

function isInKubernetesPod(): boolean {
  try {
    return fs.existsSync('/var/run/secrets/kubernetes.io/serviceaccount/token');
  } catch {
    return false;
  }
}

export async function GET() {
  const envMode = process.env.HICLAW_DEPLOYMENT_MODE;
  if (envMode === 'embedded' || envMode === 'k8s') {
    return NextResponse.json({ mode: envMode, source: 'env' });
  }

  const mode = isInKubernetesPod() ? 'k8s' : 'embedded';
  return NextResponse.json({ mode, source: 'filesystem' });
}
