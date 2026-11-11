import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {TooltipProvider} from '@/components/ui/tooltip';
import {McpServersSection} from './mcp-servers-section';
const update=vi.hoisted(()=>vi.fn().mockResolvedValue({}));
vi.mock('@/hooks/use-agentteams-mcps',()=>({
 useMcpServers:()=>({data:[{name:'qa-mcp',url:'http://example.test/mcp',transport:'streaminghttp',type:'streamable-http-proxy',description:'Existing MCP'}],refetch:vi.fn()}),
 useDeleteMcpServer:()=>({mutateAsync:vi.fn()}),
 useCreateMcpServer:()=>({mutateAsync:vi.fn(),isPending:false}),
 useUpdateMcpServer:()=>({mutateAsync:update,isPending:false}),
 useTestMcpServer:()=>({mutateAsync:vi.fn(),isPending:false}),
}));
vi.mock('@/hooks/use-mcp-catalog',()=>({useMcpCatalog:()=>({off:true,workersByServer:new Map()})}));
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
vi.stubGlobal('ResizeObserver',ResizeObserverStub);
afterEach(cleanup);
it('opens existing MCP values and saves the edited registration',async()=>{
 render(<TooltipProvider><McpServersSection/></TooltipProvider>);
 fireEvent.click(screen.getByRole('button',{name:'编辑'}));
 expect((screen.getByLabelText('服务器名称') as HTMLInputElement).value).toBe('qa-mcp');
 expect((screen.getByLabelText(/服务端点 URL/) as HTMLInputElement).value).toBe('http://example.test/mcp');
 fireEvent.change(screen.getByLabelText('描述（可选）'),{target:{value:'Edited MCP'}});
 fireEvent.click(screen.getByRole('button',{name:'保存'}));
 await waitFor(()=>expect(update).toHaveBeenCalledWith(expect.objectContaining({name:'qa-mcp',data:expect.objectContaining({description:'Edited MCP',transport:'streaminghttp',type:'streamable-http-proxy'})})));
});
