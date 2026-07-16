-- Runs once, only against a freshly-created postgres_data volume (Postgres's
-- own /docker-entrypoint-initdb.d behavior). Keeps the test suite off the dev
-- database entirely — tests must never share a database with interactive use.
CREATE DATABASE scriptorium_test;
