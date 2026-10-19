\set ON_ERROR_STOP on
\getenv app_user APP_DB_USER
\getenv kratos_user KRATOS_DB_USER

-- Kratos migrations need these extensions. Install them as the administrator
-- so neither service role needs CREATE permission on the shared database.
CREATE SCHEMA IF NOT EXISTS extensions;
REVOKE ALL ON SCHEMA extensions FROM PUBLIC;
GRANT USAGE ON SCHEMA extensions TO :"app_user", :"kratos_user";
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS btree_gin WITH SCHEMA extensions;
