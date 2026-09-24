use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Mutex, MutexGuard};
use std::thread;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

// ==================== 数据结构 ====================

/// 引擎输出事件负载（一行引擎输出，通过 "agent-engine-event" 事件推送）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEngineEventPayload {
    pub process_id: String,
    pub data: String,
}

/// 启动引擎子进程的结果
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnAgentResult {
    pub process_id: String,
}

/// 进程注册表条目：子进程 + 托管的 stdin 句柄
pub struct AgentProcessEntry {
    pub child: Child,
    pub stdin: Option<ChildStdin>,
}

// ==================== 进程注册表 ====================

// 全局进程注册表：processId -> 子进程条目
// （Mutex::new(HashMap::new()) 不是 const，因此用 Option 包裹）
static AGENT_PROCESSES: Mutex<Option<HashMap<String, AgentProcessEntry>>> = Mutex::new(None);

// 获取注册表锁（毒化时忽略毒化继续使用）
fn lock_agent_processes() -> MutexGuard<'static, Option<HashMap<String, AgentProcessEntry>>> {
    AGENT_PROCESSES.lock().unwrap_or_else(|e| e.into_inner())
}

// 子进程输出结束后清理注册表：若已退出则从注册表移除条目（同时释放托管的 stdin 句柄），
// 防止引擎自行退出且前端不再调 kill 时 Child 条目永久滞留；未退出则保留，
// 仍由 kill_agent_process 移除（对已移除的进程返回「进程不存在」，TS 侧按静默容错处理）
fn reap_agent_process(process_id: &str) {
    let mut guard = lock_agent_processes();
    // 先在 entry 借用内判定退出状态，借用结束后再执行 remove
    let exited = match guard.as_mut().and_then(|map| map.get_mut(process_id)) {
        Some(entry) => match entry.child.try_wait() {
            Ok(Some(_status)) => true,
            _ => false,
        },
        None => return,
    };
    if exited {
        if let Some(map) = guard.as_mut() {
            let _ = map.remove(process_id);
        }
    }
}

// 按行读取子进程输出并推送事件（在独立线程中运行，输出结束后尝试回收子进程）
fn spawn_output_reader<R: std::io::Read + Send + 'static>(
    app_handle: AppHandle,
    process_id: String,
    stream: R,
    line_prefix: &'static str,
) {
    thread::spawn(move || {
        let reader = BufReader::new(stream);
        for line in reader.lines() {
            match line {
                Ok(data) => {
                    let _ = app_handle.emit(
                        "agent-engine-event",
                        AgentEngineEventPayload {
                            process_id: process_id.clone(),
                            data: format!("{}{}", line_prefix, data),
                        },
                    );
                }
                Err(e) => {
                    println!("[Rust] agent output read error: {}", e);
                    break;
                }
            }
        }
        // 输出结束（子进程退出或管道关闭）：若子进程已退出则从注册表移除条目
        reap_agent_process(&process_id);
    });
}

// ==================== Tauri 命令 ====================

/// 启动引擎子进程：stdin 句柄托管在注册表，stdout/stderr 按行读出
/// 并通过 "agent-engine-event" 事件推送（stderr 行加 "[stderr] " 前缀）
#[tauri::command]
pub fn spawn_agent_process(
    app_handle: AppHandle,
    program: String,
    args: Vec<String>,
    cwd: String,
) -> Result<SpawnAgentResult, String> {
    println!("[Rust] spawn_agent_process called, program: {}", program);

    // 构建命令：stdout/stderr/stdin 全部管道化
    let mut command = Command::new(&program);
    command
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if !cwd.is_empty() {
        command.current_dir(&cwd);
    }

    let mut child = command.spawn().map_err(|e| format!("启动进程失败: {}", e))?;

    let process_id = format!("agent-{}", Uuid::new_v4());
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdin = child.stdin.take();

    // 注册进程（含 stdin 句柄托管）
    {
        let mut guard = lock_agent_processes();
        let _ = guard.get_or_insert_with(HashMap::new).insert(
            process_id.clone(),
            AgentProcessEntry { child, stdin },
        );
    }

    // stdout 按行读出并推送事件
    if let Some(stdout) = stdout {
        spawn_output_reader(app_handle.clone(), process_id.clone(), stdout, "");
    }

    // stderr 同样按行读出（加前缀），避免管道缓冲区写满导致子进程阻塞
    if let Some(stderr) = stderr {
        spawn_output_reader(app_handle, process_id.clone(), stderr, "[stderr] ");
    }

    println!(
        "[Rust] agent process spawned: {} ({})",
        process_id, program
    );

    Ok(SpawnAgentResult { process_id })
}

/// 终止并移除引擎子进程：先关闭托管的 stdin 通知退出，再强制终止并回收
#[tauri::command]
pub fn kill_agent_process(process_id: String) -> Result<(), String> {
    println!(
        "[Rust] kill_agent_process called, process_id: {}",
        process_id
    );

    // 从注册表移除条目（锁在块结束时立即释放）
    let mut entry = {
        let mut guard = lock_agent_processes();
        match guard.as_mut().and_then(|map| map.remove(&process_id)) {
            Some(entry) => entry,
            None => return Err(format!("进程不存在: {}", process_id)),
        }
    };

    // 关闭 stdin（通知交互式引擎退出），再强制终止并等待回收
    entry.stdin = None;
    let _ = entry.child.kill();
    let _ = entry.child.wait();

    println!("[Rust] agent process killed: {}", process_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::lock_agent_processes;

    #[test]
    fn registry_starts_empty() {
        let guard = lock_agent_processes();
        let is_empty = guard.as_ref().map(|map| map.is_empty()).unwrap_or(true);
        assert!(is_empty);
    }
}
