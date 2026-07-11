#!/usr/bin/env node

import { startMuseDockMcpStdio } from '../server/integrations/mcp/musedockMcpServer.mjs';

startMuseDockMcpStdio().catch(error => {
  // STDIO 的 stdout 只允许 MCP 协议消息，启动错误必须写到 stderr。
  process.stderr.write(`MuseDock MCP 启动失败：${error.message || error}\n`);
  process.exitCode = 1;
});

