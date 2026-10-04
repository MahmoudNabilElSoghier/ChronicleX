import { PermissionsService } from '../permissions.service';
import { ScopeMatcher } from '../scope-matcher';

describe('ScopeMatcher', () => {
  const permissions = { getEffectiveGrants: jest.fn() };
  const matcher = new ScopeMatcher(permissions as unknown as PermissionsService);

  beforeEach(() => jest.clearAllMocks());

  it('GROUP grant matches any target', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([
      { action: 'VIEW', resource: 'ENTRY', scopeType: 'GROUP', scopeId: '' },
    ]);
    await expect(matcher.canAccess('u1', 'VIEW', 'ENTRY', { projectId: 'p9' })).resolves.toBe(true);
  });

  it('PROJECT grant matches its own project only', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([
      { action: 'CREATE', resource: 'ENTRY', scopeType: 'PROJECT', scopeId: 'p1' },
    ]);
    await expect(
      matcher.canAccess('u1', 'CREATE', 'ENTRY', { projectId: 'p1', companyId: 'c1' }),
    ).resolves.toBe(true);
    await expect(
      matcher.canAccess('u1', 'CREATE', 'ENTRY', { projectId: 'p2', companyId: 'c1' }),
    ).resolves.toBe(false);
  });

  it('COMPANY grant matches projects inside the company', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([
      { action: 'CREATE', resource: 'ENTRY', scopeType: 'COMPANY', scopeId: 'c1' },
    ]);
    await expect(
      matcher.canAccess('u1', 'CREATE', 'ENTRY', { projectId: 'p1', companyId: 'c1' }),
    ).resolves.toBe(true);
  });

  it('wrong action never matches', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([
      { action: 'VIEW', resource: 'ENTRY', scopeType: 'GROUP', scopeId: '' },
    ]);
    await expect(
      matcher.canAccess('u1', 'DELETE', 'ENTRY', { projectId: 'p1', companyId: 'c1' }),
    ).resolves.toBe(false);
  });

  it('buildEntryWhere returns {} for GROUP viewers', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([
      { action: 'VIEW', resource: 'ENTRY', scopeType: 'GROUP', scopeId: '' },
    ]);
    await expect(matcher.buildEntryWhere('u1')).resolves.toEqual({});
  });

  it('buildEntryWhere scopes PROJECT and COMPANY grants', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([
      { action: 'VIEW', resource: 'ENTRY', scopeType: 'PROJECT', scopeId: 'p1' },
      { action: 'VIEW', resource: 'ENTRY', scopeType: 'COMPANY', scopeId: 'c2' },
    ]);
    await expect(matcher.buildEntryWhere('u1')).resolves.toEqual({
      OR: [{ projectId: { in: ['p1'] } }, { companyId: { in: ['c2'] } }],
    });
  });

  it('buildEntryWhere throws 403 with no VIEW grant', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([]);
    await expect(matcher.buildEntryWhere('u1')).rejects.toThrow('Insufficient permissions');
  });
});
