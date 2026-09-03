/**
 * Returns the 1-indexed line numbers in `newText` that differ from `oldText`,
 * so the editor can flash-highlight exactly what the agent changed (like a
 * live diff) instead of just replacing the whole buffer silently.
 *
 * Uses a classic LCS line-diff. Capped so a huge paste never blocks the UI —
 * past the cap we just skip highlighting rather than doing an expensive diff.
 */
export function changedLineNumbers(oldText: string, newText: string, cap = 4000): number[] {
  if (oldText === newText) return [];
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const n = oldLines.length;
  const m = newLines.length;
  if (n === 0) return newLines.map((_, idx) => idx + 1);
  if ((n + 1) * (m + 1) > cap * cap) return [];

  const dp: Uint32Array[] = new Array(n + 1);
  for (let i = 0; i <= n; i++) dp[i] = new Uint32Array(m + 1);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = oldLines[i] === newLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const changed: number[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      i++;
      j++;
      continue;
    }
    if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      changed.push(j + 1);
      j++;
    }
  }
  while (j < m) {
    changed.push(j + 1);
    j++;
  }
  return changed;
}
