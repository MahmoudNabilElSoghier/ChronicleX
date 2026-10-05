// TMG Archive seed (Phase 2) — idempotent via upserts.
// Run ONLY against a migrated DB: pnpm --filter @chroniclex/api exec prisma db seed
// Seeds: 3 companies, 5 projects, 5 roles + full permission catalog + grants,
// 1 SUPER_ADMIN user (admin@tmg.local / ChangeMe!2025, Argon2id).
import { PrismaClient, Action, Resource } from '../src/generated/prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

function must<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Error(`seed: missing ${what}`);
  return v;
}

type Grant = { action: Action; resource: Resource };

const ALL_ACTIONS: Action[] = ['CREATE', 'UPDATE', 'DELETE', 'RESTORE', 'VIEW', 'EXPORT'];
const ALL_RESOURCES: Resource[] = ['ENTRY', 'PROJECT', 'COMPANY', 'USER', 'AUDIT', 'AUTH'];

const all: Grant[] = ALL_ACTIONS.flatMap((action) =>
  ALL_RESOURCES.map((resource) => ({ action, resource })),
);

const on = (actions: Action[], resources: Resource[]): Grant[] =>
  actions.flatMap((action) => resources.map((resource) => ({ action, resource })));

// Role → grants matrix. PROPOSAL — confirm against the Master Context table.
const ROLE_GRANTS: Record<string, Grant[]> = {
  SUPER_ADMIN: all,
  COMPANY_ADMIN: [
    ...on(['CREATE', 'UPDATE', 'DELETE', 'RESTORE', 'VIEW', 'EXPORT'], ['ENTRY', 'PROJECT']),
    ...on(['VIEW'], ['COMPANY']),
    ...on(['CREATE', 'UPDATE', 'VIEW'], ['USER']),
    ...on(['VIEW', 'EXPORT'], ['AUDIT']),
  ],
  PROJECT_ADMIN: [
    ...on(['CREATE', 'UPDATE', 'RESTORE', 'VIEW', 'EXPORT'], ['ENTRY']),
    ...on(['VIEW', 'EXPORT'], ['PROJECT']),
    ...on(['VIEW'], ['COMPANY']),
  ],
  ARCHIVIST: [
    ...on(['CREATE', 'UPDATE', 'VIEW', 'EXPORT'], ['ENTRY']),
    ...on(['VIEW'], ['PROJECT', 'COMPANY']),
  ],
  VIEWER: [...on(['VIEW'], ['ENTRY', 'PROJECT', 'COMPANY'])],
};

const ROLES = [
  { name: 'SUPER_ADMIN', description: 'Full group-wide access' },
  { name: 'COMPANY_ADMIN', description: 'Full access within assigned company' },
  { name: 'PROJECT_ADMIN', description: 'Full entry access within assigned project' },
  { name: 'ARCHIVIST', description: 'Upload and maintain entries' },
  { name: 'VIEWER', description: 'Read-only access' },
];

async function main(): Promise<void> {
  // --- Companies ---
  const companies = await Promise.all(
    [
      { code: 9205, nameAr: 'الاسكندرية لإدارة المشروعات', nameEn: 'Alexandria Projects Management' },
      { code: 2000, nameAr: 'الشركة العربية للاستثمارات', nameEn: 'Arabian Investments' },
      { code: 1001, nameAr: 'مجموعة طلعت مصطفى القابضة', nameEn: 'Talaat Moustafa Group Holding' },
    ].map((c) =>
      prisma.company.upsert({ where: { code: c.code }, update: {}, create: c }),
    ),
  );
  const byCode = Object.fromEntries(companies.map((c) => [c.code, c]));

  // --- Projects (spread across the 3 companies) ---
  const projects: Array<{
    companyCode: number;
    code: string;
    nameAr: string;
    nameEn: string;
  }> = [
    { companyCode: 9205, code: 'SSC', nameAr: 'سان ستيفانو الساحلي', nameEn: 'San Stefano Coastal' },
    { companyCode: 9205, code: 'SSRE', nameAr: 'سان ستيفانو العقارية', nameEn: 'San Stefano Real Estate' },
    { companyCode: 2000, code: 'REHAB', nameAr: 'الرحاب', nameEn: 'Al Rehab' },
    { companyCode: 1001, code: 'MAD', nameAr: 'مدينتي', nameEn: 'Madinaty' },
    { companyCode: 1001, code: 'NOOR', nameAr: 'مدينة نور', nameEn: 'Noor City' },
  ];
  for (const p of projects) {
    const companyId = must(byCode[p.companyCode], `company ${p.companyCode}`).id;
    await prisma.project.upsert({
      where: { companyId_code: { companyId, code: p.code } },
      update: {},
      create: {
        companyId,
        code: p.code,
        nameAr: p.nameAr,
        nameEn: p.nameEn,
      },
    });
  }

  // --- Permission catalog (36 rows) ---
  for (const g of all) {
    await prisma.permission.upsert({
      where: { action_resource: { action: g.action, resource: g.resource } },
      update: {},
      create: g,
    });
  }
  const perms = await prisma.permission.findMany();
  const permId = Object.fromEntries(perms.map((p) => [`${p.action}:${p.resource}`, p.id]));

  // --- Roles + grants ---
  for (const r of ROLES) {
    const role = await prisma.role.upsert({
      where: { name: r.name },
      update: { description: r.description },
      create: r,
    });
    for (const g of ROLE_GRANTS[r.name] ?? []) {
      const permissionId = must(permId[`${g.action}:${g.resource}`], `permission ${g.action}:${g.resource}`);
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId } },
        update: {},
        create: { roleId: role.id, permissionId },
      });
    }
  }

  // --- SUPER_ADMIN user (GROUP scope, scopeId = "" sentinel) ---
  const passwordHash = await argon2.hash('ChangeMe!2025'); // argon2id by default
  const admin = await prisma.user.upsert({
    where: { email: 'admin@tmg.local' },
    update: {},
    create: {
      email: 'admin@tmg.local',
      passwordHash,
      nameAr: 'مدير النظام',
      nameEn: 'System Administrator',
      isActive: true,
    },
  });
  const superAdmin = await prisma.role.findUniqueOrThrow({ where: { name: 'SUPER_ADMIN' } });
  await prisma.userRole.upsert({
    where: {
      userId_roleId_scopeType_scopeId: {
        userId: admin.id,
        roleId: superAdmin.id,
        scopeType: 'GROUP',
        scopeId: '',
      },
    },
    update: {},
    create: { userId: admin.id, roleId: superAdmin.id, scopeType: 'GROUP', scopeId: '' },
  });

  console.log('seed ok: 3 companies, 5 projects, 5 roles, 36 permissions, 1 admin');

  // E2E-only users. NEVER in production: gated behind SEED_E2E_USERS=true,
  // which globalSetup sets for the dedicated chroniclex_e2e database.
  if (process.env.SEED_E2E_USERS === 'true') {
    await seedE2eUsers();
  }
}

async function seedE2eUsers(): Promise<void> {
  const c1 = await prisma.company.findUniqueOrThrow({ where: { code: 2000 } });
  const rehab = await prisma.project.findFirstOrThrow({
    where: { companyId: c1.id, code: 'REHAB' },
  });
  const roleId = async (name: string): Promise<string> =>
    (await prisma.role.findUniqueOrThrow({ where: { name } })).id;

  const users: Array<{
    email: string;
    password: string;
    role: string;
    scopeType: 'GROUP' | 'COMPANY' | 'PROJECT';
    scopeId: string;
  }> = [
    { email: 'super@tmg.local', password: 'SuperTest!2025', role: 'SUPER_ADMIN', scopeType: 'GROUP', scopeId: '' },
    { email: 'c1admin@tmg.local', password: 'C1Admin!2025', role: 'COMPANY_ADMIN', scopeType: 'COMPANY', scopeId: c1.id },
    { email: 'p1admin@tmg.local', password: 'P1Admin!2025', role: 'PROJECT_ADMIN', scopeType: 'PROJECT', scopeId: rehab.id },
    { email: 'archivist@tmg.local', password: 'Archiv!2025', role: 'ARCHIVIST', scopeType: 'PROJECT', scopeId: rehab.id },
    { email: 'viewer@tmg.local', password: 'Viewer!2025', role: 'VIEWER', scopeType: 'PROJECT', scopeId: rehab.id },
  ];
  for (const u of users) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        email: u.email,
        passwordHash: await argon2.hash(u.password),
        nameAr: 'مستخدم اختبار',
        nameEn: 'E2E Test User',
        isActive: true,
      },
    });
    const rid = await roleId(u.role);
    await prisma.userRole.upsert({
      where: {
        userId_roleId_scopeType_scopeId: {
          userId: user.id,
          roleId: rid,
          scopeType: u.scopeType,
          scopeId: u.scopeId,
        },
      },
      update: {},
      create: { userId: user.id, roleId: rid, scopeType: u.scopeType, scopeId: u.scopeId },
    });
  }
  console.log('seed ok: 5 E2E users');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
