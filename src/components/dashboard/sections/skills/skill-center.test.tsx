import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SkillCenter } from './skill-center';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
const update = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-skill-center', () => ({
 useSkills: () => ({data:{skills:[{name:'test-skill',description:'Existing description',version:'1.0.0',source:'custom',fileCount:1}],total:1},refetch:vi.fn()}),
 useDeleteSkill: () => ({mutateAsync:vi.fn()}),
 useUpdateSkill: () => ({mutateAsync:update,isPending:false}),
}));
vi.mock('./skill-upload-dialog', () => ({SkillUploadDialog:()=>null}));
vi.mock('./nacos-config-dialog', () => ({NacosConfigDialog:()=>null}));
vi.mock('./skill-detail-dialog', () => ({SkillDetailDialog:()=>null}));
vi.mock('./skill-distribute-to-worker-dialog', () => ({SkillDistributeToWorkerDialog:()=>null}));
beforeEach(() => useAgentTeamsStore.setState({ userLevel: 3 }));
afterEach(() => { cleanup(); useAgentTeamsStore.setState({ userLevel: 3 }); });
it('loads existing fields when opening the editor and discards cancelled edits', () => {
 render(<TooltipProvider><SkillCenter /></TooltipProvider>);
 const open = () => fireEvent.click(within(screen.getByRole('row',{name:/test-skill/})).getByRole('button', {name:'编辑'}));
 open();
 const description=screen.getByPlaceholderText('输入技能描述...') as HTMLInputElement;
 expect(description.value).toBe('Existing description');
 expect((screen.getByPlaceholderText('例如: 1.0.0') as HTMLInputElement).value).toBe('1.0.0');
 fireEvent.change(description,{target:{value:'Unsaved draft'}});
 fireEvent.click(screen.getByRole('button',{name:'取消'}));
 open();
 expect((screen.getByPlaceholderText('输入技能描述...') as HTMLInputElement).value).toBe('Existing description');
 expect(update).not.toHaveBeenCalled();
});

it.each([1, 2, 3])('applies the Skills UI permission matrix at level %i', (level) => {
 useAgentTeamsStore.setState({ userLevel: level });
 render(<TooltipProvider><SkillCenter /></TooltipProvider>);
 expect((screen.getByRole('button', {name:'详情'}) as HTMLButtonElement).disabled).toBe(false);
 for (const name of ['配置 Nacos', '上传技能', '编辑', '分发']) {
   expect(Boolean(screen.queryByRole('button', {name}))).toBe(level === 3);
 }
 expect(Boolean(screen.queryByRole('button', {name:'更多操作 test-skill'}))).toBe(level === 3);
});
