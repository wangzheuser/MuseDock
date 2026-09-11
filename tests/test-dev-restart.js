const assert = require('node:assert/strict');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { stopProcess, stopDevelopmentServers } = require('../scripts/restart-dev.cjs');

async function listen() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
}

async function childListener() {
  const child = spawn(process.execPath, ['-e', `
    const server = require('node:net').createServer();
    server.listen(0, '127.0.0.1', () => process.send(server.address().port));
  `], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'], windowsHide: true });
  try {
    const [port] = await once(child, 'message', { signal: AbortSignal.timeout(10000) });
    return { child, port };
  } catch (error) {
    child.kill();
    throw error;
  }
}

(async () => {
  if (process.platform !== 'win32') {
    console.log('跳过 Windows 开发服务重启测试。');
    return;
  }

  const ownServer = await listen();
  const unusedPort = ownServer.address().port;
  try {
    await assert.rejects(stopDevelopmentServers([unusedPort]), /不能停止当前重启进程/);
    assert.equal(ownServer.listening, true);
  } finally {
    await new Promise(resolve => ownServer.close(resolve));
  }
  console.log('PASS 拒绝停止执行重启命令的当前进程');

  assert.equal(await stopDevelopmentServers([unusedPort]), 0);
  console.log('PASS 服务未启动时正常完成清理，不阻止后续启动');

  const listeners = [];
  try {
    listeners.push(await childListener());
    listeners.push(await childListener());
    const ports = listeners.map(item => item.port);
    const exits = listeners.map(({ child }) => once(child, 'exit', { signal: AbortSignal.timeout(15000) }));
    assert.equal(await stopDevelopmentServers(ports), 2);
    await Promise.all(exits);
    assert.equal(await stopDevelopmentServers(ports), 0);
    console.log('PASS 停止两个独立的监听进程并确认端口释放，重复清理正常');

    for (const { child } of listeners) assert.doesNotThrow(() => stopProcess(child.pid));
    console.log('PASS 进程已经退出时继续清理，不把退出竞争当作失败');
  } finally {
    for (const { child } of listeners) {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
  }
  console.log('开发服务重启：4 项验证通过，仅操作临时测试进程。');
})().catch(error => { console.error(error); process.exitCode = 1; });
