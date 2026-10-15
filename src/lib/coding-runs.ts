// 编码执行记录辅助（#146 缺口 2）。

const RUN_FILE = /^run-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.log$/;

/**
 * 从 run-YYYYMMDD-HHMMSS.log 文件名推导可读时间。
 * 上游列表结构无独立时间字段，这是当前唯一可用的时间来源；无法解析时原样返回。
 */
export function parseCodingRunTime(run: string): string {
  const match = RUN_FILE.exec(run);
  if (!match) return run;
  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}
