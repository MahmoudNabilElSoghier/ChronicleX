import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';

export const E2E_USERS = {
  super: { email: 'super@tmg.local', password: 'SuperTest!2025' },
  c1admin: { email: 'c1admin@tmg.local', password: 'C1Admin!2025' },
  p1admin: { email: 'p1admin@tmg.local', password: 'P1Admin!2025' },
  archivist: { email: 'archivist@tmg.local', password: 'Archiv!2025' },
  viewer: { email: 'viewer@tmg.local', password: 'Viewer!2025' },
} as const;

export type E2EUserKey = keyof typeof E2E_USERS;

/** UI login (the real flow). Lands on /ar/dashboard. */
export async function loginAs(page: Page, key: E2EUserKey): Promise<void> {
  const user = E2E_USERS[key];
  await page.goto('/ar/login');
  await page.getByLabel(/البريد الإلكتروني/).fill(user.email);
  await page.getByLabel(/كلمة المرور/).fill(user.password);
  await page.getByRole('button', { name: /تسجيل الدخول/ }).click();
  await expect(page).toHaveURL(/\/ar\/dashboard/);
}

/** API login for test setup reads (catalog discovery, seeding). Not the flow under test. */
export async function apiLogin(request: APIRequestContext, key: E2EUserKey): Promise<string> {
  const user = E2E_USERS[key];
  const res = await request.post('http://localhost:3001/auth/login', {
    data: { email: user.email, password: user.password },
  });
  if (!res.ok()) {
    throw new Error(`API login failed for ${user.email}: ${res.status()}`);
  }
  const body = (await res.json()) as { accessToken: string };
  return body.accessToken;
}

export interface ScopeIds {
  c1: string;
  c2: string;
  rehab: string;
  outsideC1: string;
  madinaty: string;
}

/** Resolve stable company/project ids by seed code. */
export async function resolveScope(request: APIRequestContext, token: string): Promise<ScopeIds> {
  const headers = { Authorization: `Bearer ${token}` };
  const companies = (await (
    await request.get('http://localhost:3001/companies', { headers })
  ).json()) as { items: { id: string; code: number }[] };
  const c1 = companies.items.find((c) => c.code === 2000)?.id;
  const c2 = companies.items.find((c) => c.code === 1001)?.id;
  const other = companies.items.find((c) => c.code !== 2000 && c.code !== 1001)?.id;
  if (!c1 || !c2 || !other) throw new Error('seed companies missing');
  const projectsIn = async (companyId: string): Promise<{ id: string; code: string }[]> =>
    (
      (await (
        await request.get(`http://localhost:3001/projects?companyId=${companyId}`, { headers })
      ).json()) as { items: { id: string; code: string }[] }
    ).items;
  const c1Projects = await projectsIn(c1);
  const rehab = c1Projects.find((p) => p.code === 'REHAB')?.id;
  const otherProjects = await projectsIn(other);
  const outsideC1 = otherProjects[0]?.id;
  const c2Projects = await projectsIn(c2);
  const madinaty = c2Projects.find((p) => p.code === 'MAD')?.id ?? c2Projects[0]?.id;
  if (!rehab || !outsideC1 || !madinaty) throw new Error('seed projects missing');
  return { c1, c2, rehab, outsideC1, madinaty };
}
