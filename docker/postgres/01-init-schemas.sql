\set ON_ERROR_STOP on
\getenv db_name POSTGRES_DB
\getenv app_user APP_DB_USER
\getenv app_password APP_DB_PASSWORD
\getenv kratos_user KRATOS_DB_USER
\getenv kratos_password KRATOS_DB_PASSWORD

CREATE ROLE :"app_user" LOGIN PASSWORD :'app_password';
CREATE ROLE :"kratos_user" LOGIN PASSWORD :'kratos_password';

REVOKE ALL ON DATABASE :"db_name" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db_name" TO :"app_user", :"kratos_user";
REVOKE ALL ON SCHEMA public FROM PUBLIC;

CREATE SCHEMA app AUTHORIZATION :"app_user";
CREATE SCHEMA kratos AUTHORIZATION :"kratos_user";
REVOKE ALL ON SCHEMA app, kratos FROM PUBLIC;

ALTER ROLE :"app_user" IN DATABASE :"db_name" SET search_path = app, extensions;
ALTER ROLE :"kratos_user" IN DATABASE :"db_name" SET search_path = kratos, extensions;
