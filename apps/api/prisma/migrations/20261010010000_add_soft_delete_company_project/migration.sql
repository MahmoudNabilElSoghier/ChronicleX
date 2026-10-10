-- Soft deletes for the catalog: companies disappear from lists once every
-- project is soft-deleted; projects disappear once they have no recorded
-- entries to protect (deletion is refused while any entry — even a
-- soft-deleted one — references them).
ALTER TABLE "Company" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN "deletedAt" TIMESTAMP(3);
