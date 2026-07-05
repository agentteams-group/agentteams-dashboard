// Worker Template Store — Save and reuse Worker configurations

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CreateWorkerRequest } from '@/lib/hiclaw-api';

export interface WorkerTemplate {
  id: string;
  name: string;
  description: string;
  config: Omit<CreateWorkerRequest, 'name'>;
  createdAt: number;
}

interface TemplateState {
  templates: WorkerTemplate[];
  addTemplate: (_template: Omit<WorkerTemplate, 'id' | 'createdAt'>) => void;
  deleteTemplate: (_id: string) => void;
}

let templateCounter = 0;

export const useTemplateStore = create<TemplateState>()(
  persist(
    (set) => ({
      templates: [],

      addTemplate: (template) => {
        const newTemplate: WorkerTemplate = {
          ...template,
          id: `tpl-${Date.now()}-${++templateCounter}`,
          createdAt: Date.now(),
        };
        set((state) => ({
          templates: [newTemplate, ...state.templates],
        }));
      },

      deleteTemplate: (id) => {
        set((state) => ({
          templates: state.templates.filter((t) => t.id !== id),
        }));
      },
    }),
    {
      name: 'hiclaw-templates',
      version: 1,
    }
  )
);
