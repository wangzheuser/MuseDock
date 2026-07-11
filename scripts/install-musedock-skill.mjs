#!/usr/bin/env node

import { access, cp, mkdir, readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = path.resolve(SCRIPT_DIR, '../integrations/skills/musedock-video');
const MANAGED_MARKER = '<!-- musedock-video-skill -->';
const TARGETS = {
  codex: ['.agents', 'skills', 'musedock-video'],
  claude: ['.claude', 'skills', 'musedock-video'],
  cursor: ['.cursor', 'skills', 'musedock-video'],
};

/**
 * 判断路径是否存在。
 * @param {string} targetPath 目标路径。
 * @returns {Promise<boolean>} 是否存在。
 */
async function exists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 验证已有目录是否由本安装器管理，避免覆盖用户自建 Skill。
 * @param {string} targetDir Skill 目录。
 * @returns {Promise<boolean>} 是否为 MuseDock 管理目录。
 */
async function isManagedSkill(targetDir) {
  try {
    const content = await readFile(path.join(targetDir, 'SKILL.md'), 'utf8');
    return content.includes(MANAGED_MARKER);
  } catch {
    return false;
  }
}

/**
 * 安装一份 MuseDock Skill。
 * @param {string} client 客户端名称。
 * @param {{homeDir?:string}} options 安装选项。
 * @returns {Promise<string>} 安装目录。
 */
export async function installSkill(client, options = {}) {
  const segments = TARGETS[client];
  if (!segments) throw new Error(`不支持的客户端：${client}`);
  const homeDir = options.homeDir || process.env.MUSEDOCK_SKILL_HOME || homedir();
  const targetDir = path.join(homeDir, ...segments);
  if (await exists(targetDir)) {
    if (!await isManagedSkill(targetDir)) {
      throw new Error(`${targetDir} 已存在且不是 MuseDock 管理的 Skill，已停止覆盖。`);
    }
    await rm(targetDir, { recursive: true, force: true });
  }
  await mkdir(path.dirname(targetDir), { recursive: true });
  await cp(SOURCE_DIR, targetDir, { recursive: true, errorOnExist: true });
  return targetDir;
}

/**
 * 解析客户端参数。
 * @param {string} value 命令行参数。
 * @returns {string[]} 客户端列表。
 */
export function resolveClients(value = 'all') {
  if (value === 'all') return Object.keys(TARGETS);
  if (TARGETS[value]) return [value];
  throw new Error('用法：npm run skill:install -- [codex|claude|cursor|all]');
}

/**
 * 执行安装命令。
 */
async function main() {
  const clients = resolveClients(process.argv[2] || 'all');
  for (const client of clients) {
    const targetDir = await installSkill(client);
    process.stdout.write(`已为 ${client} 安装 MuseDock Skill：${targetDir}\n`);
  }
  process.stdout.write('请确保 MuseDock 服务已启动，并在客户端中配置名为 musedock 的 MCP Server。\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(error => {
    process.stderr.write(`安装 MuseDock Skill 失败：${error.message}\n`);
    process.exitCode = 1;
  });
}

