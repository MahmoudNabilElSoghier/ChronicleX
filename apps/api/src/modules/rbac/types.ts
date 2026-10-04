import type { Action, Resource, ScopeType } from '../../generated/prisma/client';

export interface ScopeHint {
  source: 'body' | 'params' | 'query';
  key: string;
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
