-- Runs once on first container start. Enables extensions used by Prisma schema.
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
