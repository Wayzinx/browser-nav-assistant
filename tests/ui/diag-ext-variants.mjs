// 为「manifest 缺少某项权限」的用例准备真实扩展副本：
// 复制 extension/、删掉指定 permission，并把夹具读取的 process.env.EXT_DIR 指向副本。
// 禁止在模块顶层调用（会在 runner 主进程收集用例时执行并把 EXT_DIR 泄漏给所有 worker）：
// 只能在用例自己的 context 夹具内调用，用返回的 dir 启动 persistent context，并立即还原 EXT_DIR（参见 TC-UI-DIAG-010/012）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function useExtensionWithoutPermission(permission) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `nav-ext-no-${permission}-`));
  fs.cpSync(path.join(ROOT, 'extension'), dir, { recursive: true });
  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const permissions = manifest.permissions || [];
  if (!permissions.includes(permission)) throw new Error(`extension/manifest.json 没有 ${permission} 权限，无法构造缺失场景`);
  manifest.permissions = permissions.filter((p) => p !== permission);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const written = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (written.permissions.includes(permission)) throw new Error(`临时扩展副本仍然包含 ${permission} 权限`);
  process.env.EXT_DIR = dir;
  return dir;
}
