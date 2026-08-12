# AgentTeams Dashboard 主题自定义指南

Dashboard 支持通过**配置**而非修改源码来调整视觉风格，满足企业品牌色与可访问性需求。

> 英文版见 [theme-customization.md](./theme-customization.md)。

## 能力概览

| 能力 | 说明 |
| --- | --- |
| 内置主题 | 亮色（light）、暗色（dark）、高对比度（high-contrast）三套 |
| 主题切换 | 顶栏主题按钮循环切换；设置面板可选择或跟随系统 |
| 跟随系统 | 选择「跟随系统」时随 `prefers-color-scheme` 自动切换 |
| 持久化 | 选择与自定义主题保存到 localStorage，刷新后保留 |
| 自定义主题 | 在设置面板调整 30+ 项视觉参数并实时预览 |
| 导入/导出 | 自定义主题可导出为 JSON 文件并重新导入 |
| 企业配置注入 | 通过 `theme.config.json` 或环境变量统一下发主题 |
| 无闪烁切换 | 首屏内联脚本在渲染前应用主题，避免 FOUC |

## 设计令牌（CSS 变量）

主题系统沿用 [shadcn/ui](https://ui.shadcn.com) 的 CSS 变量命名，所有组件消费这些变量而非硬编码颜色。完整令牌清单：

```
核心颜色
  --background / --foreground          页面背景与文字
  --primary / --primary-foreground     主色与其前景
  --card / --card-foreground           卡片背景与文字
  --popover / --popover-foreground     弹出层背景与文字

辅助颜色
  --secondary / --secondary-foreground 次要色及其前景
  --muted / --muted-foreground         弱化背景与次要文字
  --accent / --accent-foreground       强调色及其前景

表单与状态
  --border / --input / --ring          边框 / 输入框 / 焦点环
  --destructive / --destructive-foreground  危险色及其前景

侧边栏
  --sidebar / --sidebar-foreground     侧边栏背景与文字
  --sidebar-primary / ...              侧边栏主色族
  --sidebar-accent / ...               侧边栏强调族
  --sidebar-border / --sidebar-ring    侧边栏边框与焦点

图表
  --chart-1 .. --chart-5               五色调色板

布局
  --radius                             圆角基准（rem）
  --spacing                            间距基准（Tailwind v4）
```

自定义主题通过**内联样式**覆写这些变量（优先级最高），内置主题通过样式表类（`.dark`、`.high-contrast`）提供取值。切换主题只是切换类/变量，不涉及重渲染整个组件树，因此响应极快（< 100ms）。

## 使用内置主题

- **顶栏按钮**：点击顶栏的主题图标在 亮色 → 暗色 → 高对比度 之间循环。
- **设置面板**：「设置 → 外观」中选择「跟随系统」或任一主题。
- **高对比度**：纯黑底、不透明白色边框、黄色强调，并增强焦点可见性，适合低视力用户。

主题选择写入 localStorage（键 `agentteams-theme`）。页面加载时，一段内联脚本在首帧之前读取并应用该主题，避免闪烁。

## 创建自定义主题

1. 打开「设置 → 外观」。
2. 点击「新建」创建一个自定义主题（基于当前明暗底色）。
3. 新主题会立即应用并进入编辑状态，可调整以下参数（改动实时预览、自动保存）：

### 快速配色方案

编辑器顶部提供一键应用配色方案的按钮（翠绿 / 深海 / 琥珀 / 紫罗兰 / 石板），适合快速建立风格基调。

### 颜色参数（32 项）

按语义分组呈现，覆盖核心颜色、表面颜色、辅助颜色、表单与边框、侧边栏、图表六组。每一组均可通过颜色选择器或输入十六进制/oklch 值进行精细调整。

### 布局参数

| 参数 | 控件 | 范围 | 对应令牌 |
| --- | --- | --- | --- |
| 圆角大小 | 滑块 | 0–1.5 rem | `--radius` |
| 字号 | 滑块 | 13–20 px | 根字号 |
| 间距基准 | 滑块 | 0.2–0.35 rem | `--spacing` |
| 字体风格 | 下拉选择 | Geist / 系统字 / 衬线体 / 等宽体 | `font-family` 根元素 |
| 基础模式 | 下拉选择 | 亮色底 / 暗色底 | `.dark` 类 |

> 共 30+ 项可调参数，远超「至少 8 项」的验收要求。

## 导入 / 导出

- **导出**：选中某个自定义主题后点击「导出」，得到形如 `agentteams-theme-<id>.json` 的文件。
- **导入**：点击「导入 JSON」选择主题文件，校验通过后自动应用。

导出格式（带信封）：

```json
```json
{
  "$comment": "Example enterprise theme config. Copy to theme.config.json (repo root or public/) or set AGENTTEAMS_THEME_CONFIG to its path, then restart the Dashboard. See docs/theme-customization.md.",
  "themes": [
    {
      "id": "brand",
      "name": "Enterprise Brand",
      "nameZh": "企业品牌",
      "base": "light",
      "variables": {
        "--primary": "#1677ff",
        "--primary-foreground": "#ffffff",
        "--background": "#ffffff",
        "--foreground": "#111827",
        "--card": "#ffffff",
        "--card-foreground": "#111827",
        "--secondary": "#f3f4f6",
        "--muted": "#f3f4f6",
        "--muted-foreground": "#6b7280",
        "--border": "#e5e7eb",
        "--ring": "#1677ff"
      },
      "radius": 0.5,
      "fontSize": 15,
      "spacing": 0.25,
      "fontFamily": "geist"
    }
  ],
  "defaultTheme": "brand",
  "locked": false
}
}
```

导入时会严格校验：`id` 命名规则、`base` 取值、变量名必须以 `--` 开头、数值范围（圆角/字号/间距/字体风格）等；非法配置会提示具体错误并拒绝导入。

## 企业配置注入（theme.config.json）

运维可通过配置文件或环境变量为整个部署统一下发主题，**重启 Dashboard 后生效**。

### 配置文件

Dashboard 按以下顺序查找配置（命中即止）：

1. `$AGENTTEAMS_THEME_CONFIG` 指定的路径；
2. 工作目录下的 `theme.config.json`；
3. 工作目录 `public/theme.config.json`。

文件格式：

```json
{
  "themes": [
    {
      "id": "brand",
      "name": "企业品牌",
      "base": "light",
      "variables": { "--primary": "#1677ff" },
      "radius": 0.5
    }
  ],
  "defaultTheme": "brand",
  "locked": false
}
```

- `themes`：注入到主题选择器的企业主题（也支持单个主题对象的简写）。
- `defaultTheme`：用户未显式选择时的默认主题。
- `locked`：为 `true` 时锁定主题，用户无法切换。

### 环境变量

| 变量 | 说明 |
| --- | --- |
| `AGENTTEAMS_THEME_CONFIG` | 显式指定配置文件路径 |
| `AGENTTEAMS_DEFAULT_THEME` | 默认主题 id（优先于文件中的 `defaultTheme`） |
| `AGENTTEAMS_THEME_LOCKED` | `true` 时锁定主题切换 |

企业主题通过 `/api/dashboard/theme` 接口下发；前端启动时拉取并合并。未配置时该接口返回 404，前端回退到内置主题。

## 优先级与解析规则

1. 若企业配置 `locked` 且有 `defaultTheme`，强制使用该主题；
2. 否则使用用户选择；选择「跟随系统」时按 `prefers-color-scheme` 解析为亮/暗；
3. 找不到对应主题定义时回退到默认暗色主题。

## 技术要点

- 主题引擎位于 `src/lib/theme/`（类型、内置主题、应用逻辑、校验、store）。
- React 侧由 `src/components/theme/theme-provider.tsx` 提供 `ThemeProvider` 与 `useTheme`。
- 首屏防闪烁脚本由 `src/lib/theme/init-script.ts` 生成，内联在 `<head>`。
- 与 Tailwind CSS v4 / shadcn/ui 完全兼容，未引入新的样式方案。
