export interface UnitOfWork {
  /** Opaque handle adapters use to join the transaction; typed by the infrastructure layer. */
  readonly handle: unknown;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface UnitOfWorkFactory {
  begin(): Promise<UnitOfWork>;
  /** Runs fn in a unit of work, commits on return, rolls back on throw, never nests. */
  run<T>(fn: (uow: UnitOfWork) => Promise<T>): Promise<T>;
}
