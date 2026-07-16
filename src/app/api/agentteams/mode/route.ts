// GET /api/agentteams/mode - Detect deployment mode from filesystem / env.
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
  // Dashboard-specific override takes precedence.
  const envMode = process.env.AGENTTEAMS_DEPLOYMENT_MODE;
  if (envMode === 'embedded' || envMode === 'k8s') {
    return NextResponse.json({ mode: envMode, source: 'env' });
  }

  // Upstream AgentTeams convention (controller config.go): AGENTTEAMS_KUBE_MODE
  // is 'embedded' (default, single docker container) or 'incluster' (k8s/helm).
  const kubeMode = process.env.AGENTTEAMS_KUBE_MODE;
  if (kubeMode === 'incluster' || kubeMode === 'k8s') {
    return NextResponse.json({ mode: 'k8s', source: 'env' });
  }
  if (kubeMode === 'embedded') {
    return NextResponse.json({ mode: 'embedded', source: 'env' });
  }

  const mode = isInKubernetesPod() ? 'k8s' : 'embedded';
  return NextResponse.json({ mode, source: 'filesystem' });
}
