'use client';

import { useMemo } from 'react';
import { useHumans } from '@/hooks/use-hiclaw-humans';
import { checkPermission, type Permission } from '@/lib/rbac-engine';
import { useMatrixStore } from '@/lib/matrix-store';

/**
 * Permission-aware wrapper component.
 * Hides children if the current user doesn't have the required permission.
 */
export function PermissionGate({
  action,
  resourceType,
  resourceName,
  children,
  fallback = null,
}: {
  action: Permission;
  resourceType: 'worker' | 'team';
  resourceName: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { data: humans } = useHumans();
  const matrixUserId = useMatrixStore((s) => s.userId);

  const allowed = useMemo(() => {
    if (!humans || !matrixUserId) return true; // Default allow if no RBAC data

    // Find the human matching the current Matrix user
    const currentHuman = humans.find(
      (h) => h.matrixUserID === matrixUserId || h.name === matrixUserId?.split(':')[0]?.slice(1)
    );
    if (!currentHuman) return true; // Default allow if human not found

    const result = checkPermission(currentHuman, action, resourceType, resourceName);
    return result.allowed;
  }, [humans, matrixUserId, action, resourceType, resourceName]);

  return allowed ? <>{children}</> : <>{fallback}</>;
}
