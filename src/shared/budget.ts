// Connect allows 8s per invoke but callers hang up long before that.
// Downstream calls get an explicit budget and degrade instead of hanging.

export class BudgetExceededError extends Error {
  constructor(
    readonly operation: string,
    readonly budgetMs: number,
  ) {
    super(`${operation} exceeded ${budgetMs}ms budget`);
    this.name = 'BudgetExceededError';
  }
}

export async function withBudget<T>(
  operation: string,
  budgetMs: number,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new BudgetExceededError(operation, budgetMs));
    }, budgetMs);
  });
  try {
    return await Promise.race([fn(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Remaining time for downstream work, leaving headroom for the response to
 * travel back through Lex / Connect. Never returns less than `floorMs` so a
 * near-expired invoke still attempts a fast path.
 */
export function remainingBudget(
  getRemainingTimeInMillis: () => number,
  headroomMs = 300,
  floorMs = 100,
): number {
  return Math.max(floorMs, getRemainingTimeInMillis() - headroomMs);
}
