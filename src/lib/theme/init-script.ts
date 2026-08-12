/**
 * Builds the inline <head> script that applies the persisted theme before
 * first paint (prevents flash / FOUC on reload).
 *
 * The script only depends on the localStorage format of `theme-store.ts`
 * (zustand persist envelope: {"state":{...},"version":N}).
 */
export function buildThemeInitScript(storageKey: string): string {
  // Written as a compact IIFE; keep it dependency-free and ES5-ish so it
  // runs before any framework code.
  return `(function(){try{
var KEY=${JSON.stringify(storageKey)};
var raw=window.localStorage.getItem(KEY);
var themeId='system';
var customs=[];
if(raw){var p=JSON.parse(raw);if(p&&p.state){themeId=p.state.themeId||'system';customs=p.state.customThemes||[];}}
var resolved=themeId;
if(themeId==='system'){resolved=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light';}
var root=document.documentElement;
root.setAttribute('data-theme',resolved);
root.classList.toggle('dark',resolved!=='light');
root.classList.toggle('high-contrast',resolved==='high-contrast');
root.style.colorScheme=(resolved==='light')?'light':'dark';
var theme=null;
for(var i=0;i<customs.length;i++){if(customs[i].id===themeId){theme=customs[i];break;}}
if(theme){
var vars=theme.variables||{};
for(var k in vars){if(k.indexOf('--')===0)root.style.setProperty(k,vars[k]);}
if(typeof theme.radius==='number')root.style.setProperty('--radius',theme.radius+'rem');
if(typeof theme.fontSize==='number')root.style.fontSize=theme.fontSize+'px';
if(typeof theme.spacing==='number')root.style.setProperty('--spacing',theme.spacing+'rem');
if(theme.fontFamily==='system')root.style.setProperty('font-family','ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif');
else if(theme.fontFamily==='serif')root.style.setProperty('font-family','ui-serif, Georgia, Cambria, "Times New Roman", Times, serif');
else if(theme.fontFamily==='mono')root.style.setProperty('font-family','ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, monospace');
}
}catch(e){}})();`;
}
