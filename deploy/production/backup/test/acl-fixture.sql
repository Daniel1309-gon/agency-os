CREATE ROLE agency_owner LOGIN;
CREATE ROLE agency_app LOGIN;
CREATE DATABASE agency_os OWNER agency_owner;
\connect agency_os
SET ROLE agency_owner;
CREATE TABLE public.demo (id integer PRIMARY KEY);
INSERT INTO public.demo VALUES (1);
GRANT SELECT ON public.demo TO agency_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO agency_app;
