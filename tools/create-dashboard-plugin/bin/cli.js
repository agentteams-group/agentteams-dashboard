#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * create-dashboard-plugin
 *
 * Scaffolds an AgentTeams Dashboard plugin project:
 *
 *   node tools/create-dashboard-plugin/bin/cli.js my-plugin
 *   # or once published:
 *   npm create dashboard-plugin my-plugin
 *
 * The generated project runs a Vite dev server whose output the Dashboard
 * loads at runtime through its plugin loader (Settings → 插件 → 从 URL 安装,
 * or NEXT_PUBLIC_PLUGIN_DEV_URLS). Zero runtime dependencies.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const TEMPLATE_DIR = path.join(__dirname, '..', 'template');
const NAME_PATTERN = /^[a-z0-9][a-z0-9-_]*$/;

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { name: null, dir: null, description: null, selftest: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--selftest') {
      args.selftest = true;
    } else if (arg === '--dir' || arg === '-d') {
      args.dir = argv[++i];
    } else if (arg === '--description') {
      args.description = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else if (!arg.startsWith('-') && args.name === null) {
      args.name = arg;
    } else {
      fail(`未知参数: ${arg}（--help 查看用法）`);
    }
  }
  return args;
}

function printUsage() {
  console.log(`create-dashboard-plugin — AgentTeams Dashboard 插件脚手架

用法:
  create-dashboard-plugin <plugin-id> [options]

参数:
  <plugin-id>           插件 id（小写字母/数字/-/_），同时作为项目目录名
  --dir <path>          生成到指定目录（默认 ./<plugin-id>）
  --description <text>  插件描述
  --help                显示帮助

生成后:
  cd <plugin-id> && npm install && npm run dev
然后在 Dashboard「设置 → 插件 → 从 URL 安装」填入:
  http://localhost:5173/plugin.json`);
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function toDisplayName(id) {
  return id
    .split(/[-_]+/)
    .map((seg) => (seg ? seg[0].toUpperCase() + seg.slice(1) : seg))
    .join(' ');
}

function copyTemplate(targetDir, vars) {
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const from = path.join(dir, entry.name);
      const relative = path.relative(TEMPLATE_DIR, from);
      const to = path.join(targetDir, relative);
      if (entry.isDirectory()) {
        fs.mkdirSync(to, { recursive: true });
        walk(from);
      } else {
        let content = fs.readFileSync(from, 'utf8');
        for (const [key, value] of Object.entries(vars)) {
          content = content.split(`{{${key}}}`).join(value);
        }
        fs.writeFileSync(to, content);
      }
    }
  };
  walk(TEMPLATE_DIR);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let name = args.name;
  if (!name && process.stdin.isTTY) {
    name = await prompt('插件 id（小写字母/数字/-/_）: ');
  }
  if (args.selftest) {
    name = 'selftest-plugin';
  }
  if (!name) {
    printUsage();
    process.exit(1);
  }
  if (!NAME_PATTERN.test(name)) {
    fail(`插件 id "${name}" 不合法：仅允许小写字母、数字、"-"、"_"，且以字母/数字开头`);
  }

  const targetDir = path.resolve(args.dir || `./${name}`);
  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
    fail(`目录已存在且非空: ${targetDir}`);
  }

  const vars = {
    PLUGIN_ID: name,
    PLUGIN_NAME: toDisplayName(name),
    PLUGIN_DESCRIPTION: args.description || `AgentTeams Dashboard plugin: ${toDisplayName(name)}`,
  };

  fs.mkdirSync(targetDir, { recursive: true });
  copyTemplate(targetDir, vars);

  if (args.selftest) {
    console.log(`✔ selftest: 模板生成成功 (${targetDir})`);
    return;
  }

  console.log(`✔ 插件项目已生成: ${targetDir}

下一步:
  1. cd ${path.basename(targetDir)}
  2. npm install
  3. npm run dev            # 启动插件开发服务器 (http://localhost:5173)
  4. 打开 Dashboard「设置 → 插件 → 从 URL 安装」,填入:
       http://localhost:5173/plugin.json
     或在 Dashboard 环境变量中配置:
       NEXT_PUBLIC_PLUGIN_DEV_URLS=http://localhost:5173/plugin.json

开发模式下修改插件代码后,Dashboard 会自动检测并热重载插件入口。`);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
