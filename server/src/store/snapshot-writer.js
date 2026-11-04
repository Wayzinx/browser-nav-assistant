import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { now } from '../lib/clock.js';
import { log } from '../lib/logger.js';
import { listPages } from './page-repo.js';
import { listRules } from './rule-repo.js';
import { getSettings } from './settings-repo.js';
import { getLastSync, getSequences } from './state.js';

// @code C-BE-PERSIST-01
let currentWriter = null;

function buildSnapshot() {
  return {
    schemaVersion: 1,
    savedAt: now(),
    pages: listPages(),
    rules: listRules(),
    settings: getSettings(),
    seq: getSequences(),
    lastSyncAt: getLastSync()?.syncedAt ?? null,
  };
}

/**
 * 同目录写临时文件并 fsync，完整关闭后才 rename，失败时保留上一份正式快照。
 * @param {string} file 正式快照路径
 * @param {object} snapshot SnapshotV1
 * @returns {void} 写入失败向调用方抛出，由定时任务或退出编排记录错误
 */
export function writeSnapshotAtomic(file, snapshot) {
  mkdirSync(dirname(file), { recursive: true });
  const temporaryFile = `${file}.${process.pid}.tmp`;
  try {
    const descriptor = openSync(temporaryFile, 'w');
    try {
      writeFileSync(descriptor, JSON.stringify(snapshot), 'utf8');
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporaryFile, file);
  } catch (error) {
    try { rmSync(temporaryFile, { force: true }); }
    catch (cleanupError) { log('warn', 'snapshot_tmp_cleanup_failed', { code: cleanupError.code }); }
    throw error;
  }
}

/**
 * 入口已有 onStateChange 订阅，此处只调度，避免重复订阅；连续变更重新计时。
 * @param {{file:string,debounceMs?:number}} options 快照路径与防抖窗口，默认 1000 毫秒
 * @returns {{schedule:Function}} 防抖调度接口；同步刷新使用 flushSnapshotSync
 */
export function createSnapshotWriter({ file, debounceMs = 1000 }) {
  if (currentWriter?.timer) clearTimeout(currentWriter.timer);
  const writer = { file, timer: null };
  currentWriter = writer;
  return {
    schedule() {
      if (writer.timer) clearTimeout(writer.timer);
      writer.timer = setTimeout(() => {
        writer.timer = null;
        try { writeSnapshotAtomic(writer.file, buildSnapshot()); }
        catch (error) { log('error', 'snapshot_write_failed', { code: error.code ?? 'INTERNAL' }); }
      }, debounceMs);
      writer.timer.unref();
    },
  };
}

/** @returns {void} 取消待执行防抖并同步写入最新状态；未创建 writer 时不启用持久化。 */
export function flushSnapshotSync() {
  if (!currentWriter) return;
  if (currentWriter.timer) clearTimeout(currentWriter.timer);
  currentWriter.timer = null;
  writeSnapshotAtomic(currentWriter.file, buildSnapshot());
}
