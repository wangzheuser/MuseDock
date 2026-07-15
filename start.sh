#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
DEV_PID=""
API_PORT="3000"
WEB_PORT="5173"

log() {
  printf '[start.sh] %s\n' "$*"
}

process_alive() {
  [[ -n "${DEV_PID}" ]] && {
    kill -0 -- "-${DEV_PID}" 2>/dev/null || kill -0 "${DEV_PID}" 2>/dev/null
  }
}

terminate_dev_processes() {
  local signal="$1"

  [[ -n "${DEV_PID}" ]] || return 0

  # 优先结束 npm run dev 所在进程组，确保 start-server.js 派生的 API/Vite 进程一并退出。
  kill "-${signal}" -- "-${DEV_PID}" 2>/dev/null || kill "-${signal}" "${DEV_PID}" 2>/dev/null || true
}

port_pids() {
  local port="$1"
  command -v lsof >/dev/null 2>&1 || return 0
  { lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true; } | sort -u
}

free_port() {
  local port="$1"
  local name="$2"
  local pids
  pids="$(port_pids "${port}")"
  [[ -n "${pids}" ]] || return 0

  log "${name} 端口 ${port} 已被占用，正在结束占用进程：${pids//$'\n'/ }"
  while IFS= read -r pid; do
    [[ -n "${pid}" && "${pid}" =~ ^[0-9]+$ && "${pid}" != "$$" ]] || continue
    kill "${pid}" 2>/dev/null || true
  done <<< "${pids}"

  for _ in {1..20}; do
    [[ -z "$(port_pids "${port}")" ]] && return 0
    sleep 0.2
  done

  pids="$(port_pids "${port}")"
  [[ -n "${pids}" ]] || return 0
  log "${name} 端口 ${port} 仍被占用，执行强制结束：${pids//$'\n'/ }"
  while IFS= read -r pid; do
    [[ -n "${pid}" && "${pid}" =~ ^[0-9]+$ && "${pid}" != "$$" ]] || continue
    kill -9 "${pid}" 2>/dev/null || true
  done <<< "${pids}"
}

cleanup() {
  local exit_code="${1:-$?}"
  trap - INT TERM EXIT

  if process_alive; then
    log "正在停止开发服务进程组 PGID=${DEV_PID}..."
    terminate_dev_processes TERM

    for _ in {1..20}; do
      process_alive || break
      sleep 0.2
    done

    if process_alive; then
      log "进程未按预期退出，执行强制结束..."
      terminate_dev_processes KILL
    fi
  fi

  exit "${exit_code}"
}

handle_signal() {
  local signal="$1"
  log "收到 ${signal}，正在结束开发服务和当前脚本..."
  cleanup 130
}

trap 'handle_signal SIGINT' INT
trap 'handle_signal SIGTERM' TERM
trap 'cleanup $?' EXIT

cd "${SCRIPT_DIR}"

if [[ ! -f "package.json" ]]; then
  log "未找到 package.json，请确认脚本位于项目根目录。"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  log "未找到 node，请先安装 Node.js 22。"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  log "未找到 npm，请先安装 npm。"
  exit 1
fi

NODE_VERSION="$(node -p 'process.versions.node' 2>/dev/null || true)"
NODE_MAJOR="${NODE_VERSION%%.*}"
if [[ "${NODE_MAJOR}" != "22" ]]; then
  log "当前 Node.js 版本为 v${NODE_VERSION:-unknown}，项目 package.json 要求 >=22 <23；建议切换到 Node.js 22 后再启动。"
fi

if [[ ! -d "node_modules" ]]; then
  log "未检测到 node_modules，请先执行：npm ci"
  exit 1
fi

if ! command -v lsof >/dev/null 2>&1; then
  log "未找到 lsof，跳过端口占用检测。"
else
  free_port "${API_PORT}" "后端 API"
  free_port "${WEB_PORT}" "前端"
fi

log "启动开发模式：npm run dev"
log "前端入口：http://localhost:${WEB_PORT}"
log "后端 API：http://localhost:${API_PORT}"
log "按 Ctrl+C 可停止开发服务及其子进程。"

# 非交互 bash 默认不会给后台任务分配独立进程组；开启 job control 后可按进程组清理子进程。
set -m
npm run dev &
DEV_PID="$!"

wait "${DEV_PID}"
