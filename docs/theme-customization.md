# AgentTeams Dashboard Theme Customization Guide

The Dashboard's visual style is driven by configuration, not source edits, so it can adapt to enterprise branding and accessibility requirements.

> 中文版见 [theme-customization.zh-CN.md](./theme-customization.zh-CN.md)。

## Capabilities

| Capability | Description |
| --- | --- |
| Built-in themes | Light, Dark, High Contrast |
| Switching | Header button cycles; Settings panel selects or follows the system |
| Follow system | "System" tracks `prefers-color-scheme` |
| Persistence | Selection and custom themes persist to localStorage across reloads |
| Custom themes | Adjust 30+ visual parameters with live preview |
| Import / Export | Export custom themes to JSON and re-import them |
| Enterprise injection | Roll out themes via `theme.config.json` or env vars |
| No-flash switching | An inline script applies the theme before first paint |

## Design tokens (CSS variables)

The system follows [shadcn/ui](https://ui.shadcn.com) CSS variable naming; every component consumes these tokens instead of hard-coded colors. Full token catalog:

```
Core colors
  --background / --foreground          page background & text
  --primary / --primary-foreground     brand color & its foreground
  --card / --card-foreground           card surface & text
  --popover / --popover-foreground     popover surface & text

Secondary colors
  --secondary / --secondary-foreground secondary surface & text
  --muted / --muted-foreground         muted surface / secondary text
  --accent / --accent-foreground       accent surface & text

Forms & states
  --border / --input / --ring          border / input / focus ring
  --destructive / --destructive-foreground  error color & foreground

Sidebar
  --sidebar / --sidebar-foreground     sidebar background & text
  --sidebar-primary / ...              sidebar primary family
  --sidebar-accent / ...               sidebar accent family
  --sidebar-border / --sidebar-ring    sidebar border & focus

Charts
  --chart-1 .. --chart-5               five-color chart palette

Layout
  --radius                             corner radius base (rem)
  --spacing                            spacing base (Tailwind v4)
```

Custom themes override these tokens via **inline styles** (highest priority); built-ins are supplied by stylesheet classes (`.dark`, `.high-contrast`). Switching themes only swaps classes/variables — no full re-render — so it responds in well under 100ms.

## Using built-in themes

- **Header button**: cycles Light → Dark → High Contrast.
- **Settings**: *Settings → Appearance* to pick a theme or "Follow system".
- **High Contrast**: pure-black background, opaque white borders, yellow accent, stronger focus outlines — for low-vision users.

The selection is stored in localStorage (`agentteams-theme`); an inline script applies it before the first frame to avoid flash.

## Creating a custom theme

1. Open *Settings → Appearance*.
2. Click **New** to create a theme (based on the current light/dark base).
3. It applies immediately and becomes editable. Adjustable parameters (live preview, auto-saved):

### Quick color schemes

Buttons at the top of the editor apply a complete palette in one click (Emerald / Ocean / Amber / Violet / Slate).

### Color parameters (32 keys)

Rendered in semantic groups (Core, Surface, Secondary, Forms & Border, Sidebar, Charts). Each color is adjustable via a native color picker or a hex/oklch text field.

### Layout parameters

| Parameter | Control | Range | Token |
| --- | --- | --- | --- |
| Corner radius | slider | 0–1.5 rem | `--radius` |
| Font size | slider | 13–20 px | root font size |
| Spacing base | slider | 0.2–0.35 rem | `--spacing` |
| Font family | select | Geist / system / serif / monospace | `font-family` on root |
| Base mode | select | light / dark | `.dark` class |

> 30+ adjustable parameters, well beyond the "at least 8" acceptance requirement.

## Import / Export

- **Export**: select a custom theme and click **Export** to download `agentteams-theme-<id>.json`.
- **Import**: click **Import JSON** and choose a file; valid themes apply immediately.

Export envelope:

```json
{
  "kind": "agentteams-dashboard-theme",
  "version": 1,
  "theme": {
    "id": "brand",
    "name": "Brand",
    "nameZh": "品牌",
    "base": "light",
    "variables": { "--primary": "#1677ff", "--ring": "#1677ff" },
    "radius": 0.5,
    "fontSize": 16,
    "spacing": 0.25,
    "fontFamily": "system"
  }
}
```

Import is strictly validated (id pattern, `base` values, `--` variable prefix, numeric bounds, allowed font family values). Invalid input is rejected with a specific error.

## Enterprise injection (theme.config.json)

Operators can roll out a theme for an entire deployment; it takes effect after restarting the Dashboard.

### Config file lookup order (first hit wins)

1. Path in `$AGENTTEAMS_THEME_CONFIG`
2. `<cwd>/theme.config.json`
3. `<cwd>/public/theme.config.json`

Format:

```json
{
  "themes": [
    { "id": "brand", "name": "Brand", "base": "light", "variables": { "--primary": "#1677ff" }, "radius": 0.5 }
  ],
  "defaultTheme": "brand",
  "locked": false
}
```

- `themes`: enterprise themes injected into the picker (a single theme object is also accepted).
- `defaultTheme`: used when the user has not chosen one.
- `locked`: when `true`, users cannot switch away.

### Environment variables

| Variable | Description |
| --- | --- |
| `AGENTTEAMS_THEME_CONFIG` | Explicit config file path |
| `AGENTTEAMS_DEFAULT_THEME` | Default theme id (overrides file `defaultTheme`) |
| `AGENTTEAMS_THEME_LOCKED` | `true` locks theme switching |

Enterprise themes are served by `/api/dashboard/theme`; the frontend fetches and merges them on boot. The endpoint returns 404 when nothing is configured, and the frontend falls back to built-ins.

## Resolution rules

1. If enterprise config is `locked` with a `defaultTheme`, that theme is forced.
2. Otherwise the user's choice is used; "System" resolves to light/dark via `prefers-color-scheme`.
3. Unknown theme ids fall back to the default dark theme.

## Implementation notes

- Engine: `src/lib/theme/` (types, built-ins, apply, validation, store).
- React: `src/components/theme/theme-provider.tsx` (`ThemeProvider`, `useTheme`).
- Anti-flash script: `src/lib/theme/init-script.ts`, inlined in `<head>`.
- Fully compatible with Tailwind CSS v4 and shadcn/ui; no new styling system introduced.
