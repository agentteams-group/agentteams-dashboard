import { describe, expect, it } from 'vitest';
import { mainTasks, subtasksOf, subtaskProgress } from './task-hierarchy';
import type { BoardTask } from '@/hooks/use-task-board';

const task = (runId: string, fields: Partial<BoardTask> = {}): BoardTask => ({ runId, title:runId, status:'pending', assignedTo:'worker', roomId:'', dependsOn:[], createdAt:0, outcome:null, source:'api', projectId:'p', teamId:'team', ...fields });

describe('task hierarchy', () => {
  it('separates parent membership from dependencies and keeps orphan tasks visible', () => {
    const tasks = [task('main'), task('a',{parentTaskId:'main'}), task('b',{parentTaskId:'main',dependsOn:['a'],status:'completed'}), task('standalone',{dependsOn:['main']}), task('orphan',{parentTaskId:'missing'})];
    expect(mainTasks(tasks).map(t=>t.runId)).toEqual(['main','standalone','orphan']);
    expect(subtasksOf(tasks[0],tasks).map(t=>t.runId)).toEqual(['a','b']);
    expect(subtaskProgress(tasks[0],tasks)).toEqual({total:2,completed:1,percent:50});
    expect(tasks[2].dependsOn).toEqual(['a']);
  });
  it('does not combine same task ids from different projects or teams', () => {
    const root=task('main');
    const tasks=[root,task('child',{parentTaskId:'main'}),task('child',{parentTaskId:'main',teamId:'other'}),task('child',{parentTaskId:'main',projectId:'other'})];
    expect(subtasksOf(root,tasks)).toHaveLength(1);
    expect(mainTasks(tasks)).toHaveLength(3);
  });
});
