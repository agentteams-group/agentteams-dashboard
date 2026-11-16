import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {TooltipProvider} from '@/components/ui/tooltip';
import {McpServersSection} from './mcp-servers-section';
import type {McpServerConfig} from '@/lib/agentteams-api';
import {emptyMcpConnection} from '@/lib/mcp-management';
const update=vi.hoisted(()=>vi.fn().mockResolvedValue({}));
const managed=vi.hoisted(()=>({servers:undefined as McpServerConfig[]|undefined,saved:undefined as McpServerConfig|undefined}));
vi.mock('@/hooks/use-agentteams-mcps',()=>({
 useMcpServers:()=>({data:managed.servers??[{name:'qa-mcp',url:'http://example.test/mcp',transport:'streaminghttp',type:'streamable-http-proxy',description:'Existing MCP'}],refetch:vi.fn()}),
 useDeleteMcpServer:()=>({mutateAsync:vi.fn()}),
 useCreateMcpServer:()=>({mutateAsync:vi.fn(),isPending:false}),
 useUpdateMcpServer:()=>({mutateAsync:update,isPending:false}),
 useTestMcpServer:()=>({mutateAsync:vi.fn(),isPending:false}),
}));
vi.mock('./mcp-setup-dialog',()=>({McpSetupDialog:({open,onSaved}:{open:boolean;onSaved:(_server:McpServerConfig)=>void})=>open?<button onClick={()=>onSaved(managed.saved!)}>完成测试接入</button>:null}));
vi.mock('./mcp-detail-dialog',()=>({McpDetailDialog:({server}:{server:McpServerConfig})=><p>{server.verification?.message??'等待网关验证'}</p>}));
vi.mock('@/hooks/use-mcp-catalog',()=>({useMcpCatalog:()=>({off:true,workersByServer:new Map()})}));
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
vi.stubGlobal('ResizeObserver',ResizeObserverStub);
afterEach(()=>{cleanup();managed.servers=undefined;managed.saved=undefined;});
it('opens existing MCP values and saves the edited registration',async()=>{
 render(<TooltipProvider><McpServersSection/></TooltipProvider>);
 fireEvent.click(screen.getByRole('button',{name:'编辑'}));
 expect((screen.getByLabelText('服务器名称') as HTMLInputElement).value).toBe('qa-mcp');
 expect((screen.getByLabelText(/服务端点 URL/) as HTMLInputElement).value).toBe('http://example.test/mcp');
 fireEvent.change(screen.getByLabelText('描述（可选）'),{target:{value:'Edited MCP'}});
 fireEvent.click(screen.getByRole('button',{name:'保存'}));
 await waitFor(()=>expect(update).toHaveBeenCalledWith(expect.objectContaining({name:'qa-mcp',data:expect.objectContaining({description:'Edited MCP',transport:'streaminghttp',type:'streamable-http-proxy'})})));
});

it('opens the freshly verified saved connection while the directory refetch is pending',()=>{
 const existing:McpServerConfig={name:'managed-docs',url:'http://gateway/mcp-servers/managed-docs',transport:'streaminghttp',managed:true,connection:emptyMcpConnection(),createdAt:'2026-11-16T10:00:00Z',updatedAt:'2026-11-16T10:00:00Z'};
 managed.servers=[existing];
 managed.saved={...existing,updatedAt:'2026-11-16T11:00:00Z',verification:{success:true,message:'新连接验证通过',tools:[{name:'echo',inputSchema:{}}]}};
 render(<TooltipProvider><McpServersSection/></TooltipProvider>);
 fireEvent.click(screen.getByRole('button',{name:'接入 MCP'}));
 fireEvent.click(screen.getByRole('button',{name:'完成测试接入'}));
 expect(screen.getByText('新连接验证通过')).toBeTruthy();
});
