// Install the small, isolated media runtime used by the packaged application.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dataRoot = require('../server/dataRoot');
const root = path.join(dataRoot, 'data/runtime/whiteboard');
const python = path.join(root, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true, shell: false, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } });
  if (result.error || result.status !== 0) {
    console.error('白板运行环境安装失败，请检查 Python 3.10+、网络与目录写入权限。');
    process.exit(result.status || 1);
  }
}
if (!fs.existsSync(python)) run(process.env.MUSEDOCK_PYTHON || 'python', ['-m', 'venv', root]);
run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', path.join(__dirname, '../server/resources/whiteboard/requirements.txt')]);
run(python, ['-c', 'import cv2, numpy, PIL; print("白板媒体运行环境已就绪。")']);
