import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ModelsSection } from './models-section';
vi.mock('@/hooks/use-agentteams-models', () => ({ useModels: () => ({ data: [] }), useAiRoutes: () => ({ data: [] }), useCreateModel: () => ({}), useUpdateModel: () => ({}), useDeleteModel: () => ({}), useCreateAiRoute: () => ({}), useUpdateAiRoute: () => ({}), useDeleteAiRoute: () => ({}) }));
vi.mock('@/hooks/use-higress-console-access', () => ({ useHigressConsoleAccess: () => ({ canManage: true }) }));
vi.mock('@/hooks/use-agentteams-infrastructure', () => ({ useInfrastructure: () => ({ data: null }) }));
vi.mock('@/hooks/use-agentteams-managers', () => ({ useManagers: () => ({ data: [] }) }));
vi.mock('@/hooks/use-agentteams-workers', () => ({ useWorkers: () => ({ data: [] }) }));
vi.mock('./model-probe-policy-dialog', () => ({ ModelProbePolicyDialog: ({ onClose }: { onClose: () => void }) => <div role="dialog" aria-label="模型探测地址"><button onClick={onClose}>关闭探测配置</button></div> }));
afterEach(cleanup);
it('opens probe-address management next to Add connection without changing the active model tab', () => {
 render(<TooltipProvider><ModelsSection /></TooltipProvider>);
 const entry = screen.getByRole('button', { name: '探测地址' });
 expect(entry.parentElement).toBe(screen.getByRole('button', { name: '添加连接' }).parentElement);
 fireEvent.click(entry); expect(screen.getByRole('dialog', { name: '模型探测地址' })).toBeTruthy();
 fireEvent.click(screen.getByRole('button', { name: '关闭探测配置' })); expect(screen.queryByRole('dialog')).toBeNull();
 expect(screen.getByRole('tab', { name: '模型连接' }).getAttribute('aria-selected')).toBe('true');
});
