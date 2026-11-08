'use client';

// Runtime config panel — ported from the workbench plugin
// `components/runtimeCfg/RuntimeConfigPanel.tsx`.
//
// Renders a surface either:
//  - as one tab per face (OpenClaw / Hermes style surfaces), or
//  - as one tab per QwenPaw-style sub-section (reactAgent / agentLoop / …).
// Capability buckets (mcp / tools / skills / channels / approval) reuse the
// same component and keep only the faces/fields mapped to that bucket.
//
// Toolbar parity: field search, "show advanced" filter, changed-count badge
// and reset-all. A per-field "还原" action reverts a single field to the
// load-time baseline. Values/keys come exclusively from the surface — no field
// is invented client-side.

import { useMemo, useState } from 'react';
import { RotateCcw, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  advancedFields,
  buildSections,
  diffDraft,
  filterByBucket,
  filterSection,
  type CapabilityBucket,
  type PanelField,
} from '@/lib/runtime-section-model';
import {
  collectConcreteValues,
  type RuntimeSurface,
} from '@/lib/runtime-surface';
import { SUB_SECTION_LABELS, faceLabel, fieldLabel } from '@/lib/runtime-labels';
import { SchemaField } from './schema-field';

export interface RuntimeConfigPanelProps {
  surface: RuntimeSurface;
  runtime?: string;
  bucket?: CapabilityBucket;
  /** Flat dotted draft (buildDraft output). */
  draft: Record<string, unknown>;
  /** Load-time baseline (buildDraft) — changed count + reset target. */
  initialDraft: Record<string, unknown>;
  onChange: (_key: string, _value: unknown) => void;
  disabled?: boolean;
  errors?: Record<string, string>;
  values?: Record<string, unknown>;
}

function fieldsFor(
  fields: PanelField[],
  query: string,
  advancedKeys: ReadonlySet<string>,
  showAdvanced: boolean,
): PanelField[] {
  const q = query.trim().toLowerCase();
  return fields.filter((field) => {
    if (!showAdvanced && advancedKeys.has(field.key)) return false;
    if (q === '') return true;
    return `${field.key} ${field.label ?? ''} ${field.description ?? ''}`.toLowerCase().includes(q);
  });
}

export function RuntimeConfigPanel(props: RuntimeConfigPanelProps) {
  const { surface, runtime = '', bucket = 'config', draft, initialDraft, onChange, disabled, errors } =
    props;
  const [query, setQuery] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const changed = useMemo(() => diffDraft(draft, initialDraft), [draft, initialDraft]);
  const changedSet = useMemo(() => new Set(changed), [changed]);

  const faceMode = (surface.faces ?? []).length > 0 && runtime !== 'qwenpaw';
  const allSections = useMemo(() => buildSections(surface), [surface]);
  const advancedKeys = useMemo(() => {
    const set = new Set<string>();
    for (const section of allSections) {
      for (const field of advancedFields(section)) set.add(field.key);
    }
    return set;
  }, [allSections]);

  const renderField = (field: PanelField) => {
    const star = field.key.includes('*');
    const value = star
      ? collectConcreteValues(field.key, props.values ?? {})
      : draft[field.key];
    const canRevert = !star && changedSet.has(field.key);
    return (
      <div key={field.key} className="flex items-start gap-2 border-b border-border/40 py-2 last:border-0">
        <div className="min-w-0 flex-1">
          <SchemaField
            field={field}
            value={value}
            onChange={(next) => onChange(field.key, next)}
            disabled={disabled}
            readOnly={star}
            error={errors?.[field.key]}
          />
        </div>
        {canRevert ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 px-2 text-xs"
            disabled={disabled}
            aria-label={`还原 ${fieldLabel(field.key, field.label)}`}
            onClick={() => onChange(field.key, initialDraft[field.key])}
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            还原
          </Button>
        ) : null}
      </div>
    );
  };

  const faceTabs = useMemo(() => {
    if (!faceMode) return [];
    return filterByBucket(runtime, surface, bucket)
      .map((face) => {
        const subSections = face.subSections
          .map((sub) => ({
            id: sub.id,
            label: sub.label,
            fields: fieldsFor(sub.fields, query, advancedKeys, showAdvanced),
          }))
          .filter((sub) => sub.fields.length > 0);
        const flat = fieldsFor(face.fields, query, advancedKeys, showAdvanced);
        return {
          key: face.id,
          label: faceLabel(runtime, face.id, face.label),
          fields: flat,
          subs: subSections,
        };
      })
      .filter((tab) => tab.fields.length > 0 || tab.subs.length > 0);
  }, [faceMode, runtime, surface, bucket, query, advancedKeys, showAdvanced]);

  const sectionTabs = useMemo(() => {
    if (faceMode) return [];
    const configSection = allSections.find((section) => section.id === 'config');
    if (!configSection) return [];
    return filterSection(configSection, query)
      .subSections.map((sub) => ({
        key: sub.id || 'default',
        label: SUB_SECTION_LABELS[sub.id] ?? sub.id,
        fields: fieldsFor(sub.fields, '', advancedKeys, showAdvanced),
        subs: [] as Array<{ id: string; label: string; fields: PanelField[] }>,
      }))
      .filter((tab) => tab.fields.length > 0);
  }, [faceMode, allSections, query, advancedKeys, showAdvanced]);

  // Capability bucket with several faces: section headings inside one card.
  const groups = useMemo(() => {
    if (!faceMode || bucket === 'config') return [];
    return filterByBucket(runtime, surface, bucket)
      .map((face) => {
        const section = allSections.find((item) => item.id === face.id);
        const filtered = section ? filterSection(section, query) : null;
        return {
          id: face.id,
          title: faceLabel(runtime, face.id, face.label),
          fields: fieldsFor(filtered ? filtered.fields : face.fields, '', advancedKeys, showAdvanced),
        };
      })
      .filter((group) => group.fields.length > 0);
  }, [faceMode, bucket, runtime, surface, allSections, query, advancedKeys, showAdvanced]);

  const tabs = faceMode ? faceTabs : sectionTabs;
  const hitCount = groups.length > 0
    ? groups.reduce((n, group) => n + group.fields.length, 0)
    : tabs.reduce(
        (n, tab) =>
          n +
          (tab.subs.length > 0
            ? tab.subs.reduce((m, sub) => m + sub.fields.length, 0)
            : tab.fields.length),
        0,
      );

  if (faceMode && groups.length === 0 && tabs.length === 0) {
    return (
      <p className="p-3 text-xs text-muted-foreground">
        该运行时没有这部分配置面
      </p>
    );
  }

  if (!faceMode && tabs.length === 0) {
    return <p className="p-3 text-xs text-muted-foreground">暂无可配置字段</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[160px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            className="h-9 pl-7 text-sm"
            placeholder="搜索字段…"
            aria-label="搜索字段"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <span className="text-xs text-muted-foreground">{hitCount} 个命中</span>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Switch
            checked={showAdvanced}
            onCheckedChange={setShowAdvanced}
            aria-label="显示高级字段"
          />
          显示高级
        </label>
        <div className="flex-1" />
        {changed.length > 0 ? (
          <Badge variant="outline" className="border-amber-500/50 text-xs text-amber-700 dark:text-amber-400">
            已改 {changed.length} 项
          </Badge>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 text-xs"
          disabled={disabled || changed.length === 0}
          onClick={() => {
            for (const key of changed) onChange(key, initialDraft[key]);
          }}
        >
          重置
        </Button>
      </div>

      {groups.length > 0 ? (
        <div className="space-y-4">
          {groups.map((group) => (
            <section key={group.id} className="space-y-1">
              <h4 className="text-xs font-semibold">{group.title}</h4>
              <div>{group.fields.map(renderField)}</div>
            </section>
          ))}
        </div>
      ) : (
        <Tabs key={tabs.map((tab) => tab.key).join('|')} defaultValue={tabs[0]?.key}>
          <TabsList className="h-auto w-full justify-start overflow-x-auto">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.key} value={tab.key} className="shrink-0 px-3 text-xs">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {tabs.map((tab) => (
            <TabsContent key={tab.key} value={tab.key} className="space-y-2">
              {tab.subs.length > 0
                ? tab.subs.map((sub) => (
                    <div key={sub.id} className="space-y-1">
                      {sub.id ? (
                        <h4 className="pt-1 text-xs text-muted-foreground">{sub.label}</h4>
                      ) : null}
                      <div>{sub.fields.map(renderField)}</div>
                    </div>
                  ))
                : tab.fields.map(renderField)}
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}

export default RuntimeConfigPanel;
