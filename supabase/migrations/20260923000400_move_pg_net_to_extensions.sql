-- Security advisor (0014 extension_in_public): `create extension pg_net` without a
-- schema registered it in `public`. pg_net can't be relocated, so recreate it in
-- `extensions`. Its functions keep living in the `net` schema, so
-- private.trigger_collector() is unaffected.
drop extension if exists pg_net;
create extension pg_net with schema extensions;
