-- The environments QA record results on: Local, Dev, Staging, Prod.
--
-- QA run tests on their own machine (Local) and against Dev, Staging and
-- Prod, and every result says which. New projects start with those four.
-- Projects still on the first default (Dev, QA, Staging, untouched by their
-- admins) gain Local and Prod and keep QA; a list an admin has changed is
-- left as it is. Admins change theirs in project settings → Tests.

alter table public.projects alter column test_environments set default '{Local,Dev,Staging,Prod}';

update public.projects
   set test_environments = '{Local,Dev,QA,Staging,Prod}'
 where test_environments = '{Dev,QA,Staging}';
