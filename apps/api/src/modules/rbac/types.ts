import type { Action, Resource, ScopeType } from '../../generated/prisma/client';

export interface ScopeHint {
  source: 'body' | 'params' | 'query';
  key: string;
  /** Resolve the chain against a different resource than the required one
   * (e.g. CREATE ENTRY carries a projectId — resolve as PROJECT). */
  resolveAs?: Resource;
}

export interface Scope {
  scopeType: ScopeType;
  scopeId: string;
}

/** Ordered most-specific → least. Always ends with { GROUP, '' }. */
export type ScopeChain = Scope[];

export interface Grant {
  action: Action;
  resource: Resource;
  scopeType: ScopeType;
  scopeId: string;
}
