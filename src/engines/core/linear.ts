/**
 * Solves A x = b by Gaussian elimination with partial pivoting.
 * Returns null if the matrix is singular. Sizes here are tiny (tens of nodes).
 */
export function solveLinear(A: number[][], b: number[][]): number[][] | null {
  const n = A.length;
  const m = b[0]?.length ?? 0;
  const M = A.map((row, i) => [...row, ...b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      if (f === 0) continue;
      for (let c = col; c < n + m; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row.slice(n).map((v) => v / M[i][i]));
}

/** Union-find over string keys. */
export class UnionFind {
  private parent = new Map<string, string>();
  find(k: string): string {
    let p = this.parent.get(k);
    if (p === undefined) {
      this.parent.set(k, k);
      return k;
    }
    if (p === k) return k;
    p = this.find(p);
    this.parent.set(k, p);
    return p;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}
