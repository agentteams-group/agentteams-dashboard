'use client';

import { useRef } from 'react';
import { toast } from 'sonner';
import {
  Sun,
  Moon,
  Contrast,
  Monitor,
  Palette,
  Plus,
  Trash2,
  Download,
  Upload,
  Lock,
  Blend,
  Droplets,
  Sparkles,
  Feather,
  Layers,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTheme } from '@/components/theme/theme-provider';
import { useThemeStore } from '@/lib/theme/theme-store';
import {
  EDITABLE_COLOR_GROUPS,
  EDITABLE_COLOR_LABELS,
  FONT_FAMILY_LABELS,
  FONT_SIZE_BOUNDS,
  RADIUS_BOUNDS,
  SPACING_BOUNDS,
  SYSTEM_THEME_ID,
  type ThemeFontFamily,
  type ThemeBase,
  type ThemeDefinition,
  type ThemeAnimationSpeed,
  type ThemeBackgroundType,
  type ThemeGradientDirection,
} from '@/lib/theme/types';
import {
  exportTheme,
  parseExportedTheme,
  slugifyThemeId,
  ThemeConfigError,
} from '@/lib/theme/config';

/**
 * Settings → 外观 tab.
 * Theme switching, custom theme editor (≥30 visual parameters) and
 * JSON import/export.
 */

const LIGHT_PRESET: Record<string, string> = {
  '--primary': '#10b981',
  '--primary-foreground': '#ffffff',
  '--background': '#ffffff',
  '--foreground': '#111827',
  '--card': '#ffffff',
  '--card-foreground': '#111827',
  '--popover': '#ffffff',
  '--popover-foreground': '#111827',
  '--secondary': '#f3f4f6',
  '--secondary-foreground': '#111827',
  '--muted': '#f3f4f6',
  '--muted-foreground': '#6b7280',
  '--accent': '#f3f4f6',
  '--accent-foreground': '#111827',
  '--border': '#e5e7eb',
  '--input': '#e5e7eb',
  '--ring': '#10b981',
  '--destructive': '#ef4444',
  '--destructive-foreground': '#ffffff',
};

const DARK_PRESET: Record<string, string> = {
  '--primary': '#10b981',
  '--primary-foreground': '#ffffff',
  '--background': '#0a0a0a',
  '--foreground': '#fafafa',
  '--card': '#171717',
  '--card-foreground': '#fafafa',
  '--popover': '#171717',
  '--popover-foreground': '#fafafa',
  '--secondary': '#262626',
  '--secondary-foreground': '#fafafa',
  '--muted': '#262626',
  '--muted-foreground': '#a3a3a3',
  '--accent': '#262626',
  '--accent-foreground': '#fafafa',
  '--border': '#3f3f46',
  '--input': '#3f3f46',
  '--ring': '#10b981',
  '--destructive': '#f87171',
  '--destructive-foreground': '#ffffff',
};

/** Quick color scheme presets for one-click application. */
const COLOR_SCHEMES: Record<string, { label: string; variables: Record<string, string> }> = {
  emerald: {
    label: '翠绿',
    variables: {
      '--primary': '#10b981',
      '--primary-foreground': '#ffffff',
      '--background': '#0a0a0a',
      '--foreground': '#fafafa',
      '--card': '#171717',
      '--card-foreground': '#fafafa',
      '--destructive': '#f87171',
      '--border': '#3f3f46',
    },
  },
  ocean: {
    label: '深海',
    variables: {
      '--primary': '#3b82f6',
      '--primary-foreground': '#ffffff',
      '--background': '#0f172a',
      '--foreground': '#f1f5f9',
      '--card': '#1e293b',
      '--card-foreground': '#f1f5f9',
      '--destructive': '#ef4444',
      '--border': '#334155',
    },
  },
  amber: {
    label: '琥珀',
    variables: {
      '--primary': '#f59e0b',
      '--primary-foreground': '#ffffff',
      '--background': '#1c1917',
      '--foreground': '#fafaf9',
      '--card': '#292524',
      '--card-foreground': '#fafaf9',
      '--destructive': '#ef4444',
      '--border': '#44403c',
    },
  },
  violet: {
    label: '紫罗兰',
    variables: {
      '--primary': '#8b5cf6',
      '--primary-foreground': '#ffffff',
      '--background': '#0d0b14',
      '--foreground': '#faf5ff',
      '--card': '#1e1a2e',
      '--card-foreground': '#faf5ff',
      '--destructive': '#f43f5e',
      '--border': '#2d2640',
    },
  },
  slate: {
    label: '石板',
    variables: {
      '--primary': '#64748b',
      '--primary-foreground': '#ffffff',
      '--background': '#0f172a',
      '--foreground': '#f8fafc',
      '--card': '#1e293b',
      '--card-foreground': '#f8fafc',
      '--destructive': '#ef4444',
      '--border': '#334155',
    },
  },
};

function themeIcon(id: string, base: ThemeBase) {
  if (id === 'high-contrast') return <Contrast className="w-4 h-4" />;
  return base === 'dark' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />;
}

export function ThemeTab() {
  const { theme, setTheme, themes, resolvedTheme, locked } = useTheme();
  const addCustomTheme = useThemeStore((s) => s.addCustomTheme);
  const updateCustomTheme = useThemeStore((s) => s.updateCustomTheme);
  const removeCustomTheme = useThemeStore((s) => s.removeCustomTheme);
  const customThemes = useThemeStore((s) => s.customThemes);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const editingTheme =
    themes.find((t) => t.id === theme && !t.builtin && !t.enterprise) ?? null;

  const handleCreateCustom = () => {
    const base: ThemeBase = resolvedTheme.base;
    const taken = new Set(themes.map((t) => t.id));
    const id = slugifyThemeId(`my-theme`, taken);
    const themeDef: ThemeDefinition = {
      id,
      name: '我的主题',
      base,
      variables: { ...(base === 'dark' ? DARK_PRESET : LIGHT_PRESET) },
      radius: 0.625,
      fontSize: 16,
    };
    addCustomTheme(themeDef);
    setTheme(id);
    toast.success('已创建自定义主题，现在可以调整各项参数');
  };

  const handleDelete = (id: string) => {
    removeCustomTheme(id);
    toast.success('已删除自定义主题');
  };

  const handleExport = () => {
    if (!editingTheme) return;
    const json = exportTheme(editingTheme);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agentteams-theme-${editingTheme.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const imported = parseExportedTheme(text);
      addCustomTheme(imported);
      setTheme(imported.id);
      toast.success(`主题「${imported.name}」导入成功`);
    } catch (err) {
      const message = err instanceof ThemeConfigError ? err.message : '导入失败';
      toast.error(message);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Theme picker ─────────────────────────────── */}
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Palette className="w-3.5 h-3.5" />
          主题
        </Label>
        {locked && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Lock className="w-3 h-3" />
            企业配置已锁定主题切换
          </p>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <ThemeCard
            active={theme === SYSTEM_THEME_ID}
            disabled={locked}
            onClick={() => setTheme(SYSTEM_THEME_ID)}
            icon={<Monitor className="w-4 h-4" />}
            label="跟随系统"
          />
          {themes.map((t) => (
            <ThemeCard
              key={t.id}
              active={theme === t.id}
              disabled={locked}
              onClick={() => setTheme(t.id)}
              icon={themeIcon(t.id, t.base)}
              label={t.nameZh || t.name}
              badges={[
                ...(t.builtin ? ['内置'] : []),
                ...(t.enterprise ? ['企业'] : []),
                ...(!t.builtin && !t.enterprise ? ['自定义'] : []),
              ]}
            />
          ))}
        </div>
      </div>

      {/* ── Custom theme management ──────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>自定义主题</Label>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleCreateCustom} disabled={locked}>
              <Plus className="w-3.5 h-3.5 mr-1" />
              新建
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={locked}
            >
              <Upload className="w-3.5 h-3.5 mr-1" />
              导入 JSON
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleImportFile(file);
                e.target.value = '';
              }}
            />
          </div>
        </div>

        {customThemes.length === 0 && (
          <p className="text-xs text-muted-foreground">
            暂无自定义主题。点击「新建」创建，或导入 JSON 主题配置。
          </p>
        )}

        {customThemes.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-2 rounded-lg border p-2.5 text-sm"
          >
            {themeIcon(t.id, t.base)}
            <span className="flex-1 truncate">{t.nameZh || t.name}</span>
            <Badge variant="outline" className="text-[10px]">
              {t.base === 'dark' ? '暗色底' : '亮色底'}
            </Badge>
            {theme === t.id && (
              <Button variant="outline" size="sm" onClick={handleExport}>
                <Download className="w-3.5 h-3.5 mr-1" />
                导出
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive"
              onClick={() => handleDelete(t.id)}
              disabled={locked}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        ))}
      </div>

      {/* ── Editor ───────────────────────────────────── */}
      {editingTheme && (
        <ThemeEditor
          key={editingTheme.id}
          theme={editingTheme}
          onChange={(next) => updateCustomTheme(next)}
        />
      )}
    </div>
  );
}

function ThemeCard({
  active,
  disabled,
  onClick,
  icon,
  label,
  badges = [],
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badges?: string[];
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border p-3 text-left text-sm transition-colors flex flex-col gap-1.5 ${
        active
          ? 'border-primary bg-primary/5 ring-1 ring-primary'
          : 'border-border hover:border-primary/50'
      } disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      <span className="flex items-center gap-1.5">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      {badges.length > 0 && (
        <span className="flex gap-1">
          {badges.map((b) => (
            <Badge key={b} variant="secondary" className="text-[9px] px-1 h-4">
              {b}
            </Badge>
          ))}
        </span>
      )}
    </button>
  );
}

function ThemeEditor({
  theme,
  onChange,
}: {
  theme: ThemeDefinition;
  onChange: (_next: ThemeDefinition) => void;
}) {
  const variables = theme.variables ?? {};

  const setColor = (key: string, value: string) => {
    onChange({ ...theme, variables: { ...variables, [key]: value } });
  };

  const applyPreset = (presetVars: Record<string, string>) => {
    onChange({
      ...theme,
      variables: { ...variables, ...presetVars },
    });
    toast.success('已应用配色方案');
  };

  const updateNumber = (key: keyof ThemeDefinition, value: number) => {
    onChange({ ...theme, [key]: value });
  };

  return (
    <div className="space-y-4 rounded-lg border p-4" data-testid="theme-editor">
      <Label className="flex items-center gap-2">
        <Palette className="w-3.5 h-3.5" />
        编辑「{theme.nameZh || theme.name}」（改动实时预览并自动保存）
      </Label>

      {/* Name and base */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">主题名称</Label>
          <Input
            value={theme.nameZh || theme.name}
            onChange={(e) => onChange({ ...theme, nameZh: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">基础模式</Label>
          <Select
            value={theme.base}
            onValueChange={(value) => onChange({ ...theme, base: value as ThemeBase })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="light">亮色底</SelectItem>
              <SelectItem value="dark">暗色底</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Quick color scheme presets */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">快速配色方案</Label>
        <div className="flex flex-wrap gap-2">
          {Object.entries(COLOR_SCHEMES).map(([id, preset]) => (
            <Button
              key={id}
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => applyPreset(preset.variables)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Grouped color parameters */}
      {EDITABLE_COLOR_GROUPS.map((group) => (
        <div key={group.label} className="space-y-2">
          <Label className="text-xs text-muted-foreground">{group.label}</Label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {group.keys.map((key) => {
              const cssVar = `--${key}`;
              const value = variables[cssVar] ?? '#888888';
              const safeHex = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#888888';
              return (
                <div key={key} className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    {EDITABLE_COLOR_LABELS[key]}
                  </Label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="color"
                      aria-label={EDITABLE_COLOR_LABELS[key]}
                      value={safeHex}
                      onChange={(e) => setColor(cssVar, e.target.value)}
                      className="h-8 w-9 rounded border border-border bg-transparent p-0.5 cursor-pointer"
                    />
                    <Input
                      value={value}
                      onChange={(e) => setColor(cssVar, e.target.value)}
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* ── Visual Effects Section ──────────────────── */}
      <div className="border-t pt-4 space-y-4">
        <Label className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5" />
          视觉效果
        </Label>

        {/* Animation Speed */}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">动画速度</Label>
          <Select
            value={theme.animationSpeed ?? 'normal'}
            onValueChange={(value) => onChange({ ...theme, animationSpeed: value as ThemeAnimationSpeed })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">无动画</SelectItem>
              <SelectItem value="slow">缓慢</SelectItem>
              <SelectItem value="normal">正常</SelectItem>
              <SelectItem value="fast">快速</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Background Type */}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">背景效果</Label>
          <div className="grid grid-cols-5 gap-2">
            {([
              { value: 'solid', label: '纯色', icon: <Zap className="w-3.5 h-3.5" /> },
              { value: 'gradient', label: '渐变', icon: <Blend className="w-3.5 h-3.5" /> },
              { value: 'mesh', label: '网格', icon: <Layers className="w-3.5 h-3.5" /> },
              { value: 'noise', label: '噪点', icon: <Feather className="w-3.5 h-3.5" /> },
              { value: 'particles', label: '粒子', icon: <Sparkles className="w-3.5 h-3.5" /> },
            ] as const).map(({ value, label, icon }) => (
              <button
                key={value}
                onClick={() => onChange({ ...theme, backgroundType: value as ThemeBackgroundType })}
                className={`flex flex-col items-center gap-1 p-2 rounded-md border text-xs transition-colors ${
                  theme.backgroundType === value
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                {icon}
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Gradient Controls (shown when gradient/mesh selected) */}
        {(theme.backgroundType === 'gradient' || theme.backgroundType === 'mesh') && (
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">渐变方向</Label>
            <Select
              value={theme.gradientDirection ?? 'to-br'}
              onValueChange={(value) => onChange({ ...theme, gradientDirection: value as ThemeGradientDirection })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="to-t">至上</SelectItem>
                <SelectItem value="to-tr">至右上</SelectItem>
                <SelectItem value="to-r">至右</SelectItem>
                <SelectItem value="to-br">至右下</SelectItem>
                <SelectItem value="to-b">至下</SelectItem>
                <SelectItem value="to-bl">至左下</SelectItem>
                <SelectItem value="to-l">至左</SelectItem>
                <SelectItem value="to-tl">至左上</SelectItem>
                <SelectItem value="radial">径向</SelectItem>
                <SelectItem value="conic">锥形</SelectItem>
              </SelectContent>
            </Select>

            <Label className="text-xs text-muted-foreground">渐变颜色（至少 2 个）</Label>
            <div className="flex flex-wrap gap-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input
                    type="color"
                    aria-label={`渐变颜色 ${i + 1}`}
                    value={theme.gradientColors?.[i] ?? (i === 0 ? '#10b981' : i === 1 ? '#3b82f6' : '#8b5cf6')}
                    onChange={(e) => {
                      const colors = [...(theme.gradientColors ?? [''])];
                      colors[i] = e.target.value;
                      onChange({ ...theme, gradientColors: colors });
                    }}
                    className="h-8 w-9 rounded border border-border bg-transparent p-0.5 cursor-pointer"
                  />
                  <Input
                    value={theme.gradientColors?.[i] ?? ''}
                    onChange={(e) => {
                      const colors = [...(theme.gradientColors ?? [''])];
                      colors[i] = e.target.value;
                      onChange({ ...theme, gradientColors: colors });
                    }}
                    placeholder={`颜色 ${i + 1}`}
                    className="h-8 text-xs font-mono w-28"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Noise opacity (shown when noise selected) */}
        {theme.backgroundType === 'noise' && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              噪点透明度（{theme.noiseOpacity ?? 0.03}）
            </Label>
            <input
              type="range"
              aria-label="噪点透明度"
              min={0}
              max={0.15}
              step={0.005}
              value={theme.noiseOpacity ?? 0.03}
              onChange={(e) => updateNumber('noiseOpacity', Number(e.target.value))}
              className="w-full accent-[var(--primary)]"
            />
          </div>
        )}

        {/* Particle density (shown when particles selected) */}
        {theme.backgroundType === 'particles' && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              粒子密度（{theme.particleDensity ?? 30}）
            </Label>
            <input
              type="range"
              aria-label="粒子密度"
              min={0}
              max={100}
              step={5}
              value={theme.particleDensity ?? 30}
              onChange={(e) => updateNumber('particleDensity', Number(e.target.value))}
              className="w-full accent-[var(--primary)]"
            />
          </div>
        )}
      </div>

      {/* ── Surface Transparency Section ────────────── */}
      <div className="border-t pt-4 space-y-4">
        <Label className="flex items-center gap-2">
          <Droplets className="w-3.5 h-3.5" />
          表面透明度与毛玻璃
        </Label>

        {/* Surface transparency */}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">
            表面透明度（{typeof theme.surfaceTransparency === 'number' ? theme.surfaceTransparency.toFixed(2) : '1.00'}，1=不透明)
          </Label>
          <input
            type="range"
            aria-label="表面透明度"
            min={0}
            max={1}
            step={0.01}
            value={theme.surfaceTransparency ?? 1}
            onChange={(e) => updateNumber('surfaceTransparency', Number(e.target.value))}
            className="w-full accent-[var(--primary)]"
          />
        </div>

        {/* Backdrop blur */}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">
            毛玻璃模糊（{typeof theme.backdropBlur === 'number' ? theme.backdropBlur : 0}px）
          </Label>
          <input
            type="range"
            aria-label="毛玻璃模糊"
            min={0}
            max={40}
            step={1}
            value={theme.backdropBlur ?? 0}
            onChange={(e) => updateNumber('backdropBlur', Number(e.target.value))}
            className="w-full accent-[var(--primary)]"
          />
        </div>
      </div>

      {/* ── Typography Section ──────────────────────── */}
      <div className="border-t pt-4 space-y-4">
        <Label className="flex items-center gap-2">
          <Feather className="w-3.5 h-3.5" />
          排版设置
        </Label>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">字体风格</Label>
          <Select
            value={theme.fontFamily}
            onValueChange={(value) => onChange({ ...theme, fontFamily: value as ThemeFontFamily })}
          >
            <SelectTrigger>
              <SelectValue placeholder="选择字体风格" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(FONT_FAMILY_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── Layout Section ─────────────────────────── */}
      <div className="border-t pt-4 space-y-4">
        <Label className="flex items-center gap-2">
          <Layers className="w-3.5 h-3.5" />
          布局参数
        </Label>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              圆角大小（{theme.radius ?? 0.625} rem）
            </Label>
            <input
              type="range"
              aria-label="圆角大小"
              min={RADIUS_BOUNDS.min}
              max={RADIUS_BOUNDS.max}
              step={RADIUS_BOUNDS.step}
              value={theme.radius ?? 0.625}
              onChange={(e) => onChange({ ...theme, radius: Number(e.target.value) })}
              className="w-full accent-[var(--primary)]"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              字号（{theme.fontSize ?? 16} px，缩放整体界面）
            </Label>
            <input
              type="range"
              aria-label="字号"
              min={FONT_SIZE_BOUNDS.min}
              max={FONT_SIZE_BOUNDS.max}
              step={FONT_SIZE_BOUNDS.step}
              value={theme.fontSize ?? 16}
              onChange={(e) => onChange({ ...theme, fontSize: Number(e.target.value) })}
              className="w-full accent-[var(--primary)]"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              间距基准（{theme.spacing ?? 0.25} rem）
            </Label>
            <input
              type="range"
              aria-label="间距基准"
              min={SPACING_BOUNDS.min}
              max={SPACING_BOUNDS.max}
              step={SPACING_BOUNDS.step}
              value={theme.spacing ?? 0.25}
              onChange={(e) => onChange({ ...theme, spacing: Number(e.target.value) })}
              className="w-full accent-[var(--primary)]"
            />
          </div>
        </div>
      </div>

      {/* ── Advanced CSS ────────────────────────────── */}
      <div className="border-t pt-4 space-y-4">
        <Label className="flex items-center gap-2">
          <Zap className="w-3.5 h-3.5" />
          高级选项
        </Label>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">自定义 Body 类名</Label>
          <Input
            placeholder="可选，用于添加额外 CSS 类"
            value={theme.bodyClass ?? ''}
            onChange={(e) => onChange({ ...theme, bodyClass: e.target.value || undefined })}
          />
        </div>
      </div>
    </div>
  );
}
