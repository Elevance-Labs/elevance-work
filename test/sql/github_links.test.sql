-- GitHub links: read by whoever can see the issue, written by nobody but the
-- `github` Edge Function (service role).

select t.login('sara');
select t.eq('an issue to link to', t.new_issue('WEB', 'Hero banner'), 'WEB-1');
select t.eq('…and another', t.new_issue('WEB', 'Footer'), 'WEB-2');

select t.superuser();
insert into public.issue_dev_links (issue_id, kind, repo, ref, title, url, state)
select id, 'pull_request', 'Elevance-Labs/site', '7', 'Hero banner', 'https://github.com/Elevance-Labs/site/pull/7', 'open'
  from public.issues where key = 'WEB-2';
insert into public.issue_dev_links (issue_id, kind, repo, ref, title, url)
select id, 'branch', 'Elevance-Labs/site', 'web-2-hero', 'web-2-hero', 'https://github.com/Elevance-Labs/site/tree/web-2-hero'
  from public.issues where key = 'WEB-2';

select t.throws('the same thing is recorded once per issue',
  $$insert into public.issue_dev_links (issue_id, kind, repo, ref, url)
    select id, 'branch', 'Elevance-Labs/site', 'web-2-hero', 'https://github.com/x' from public.issues where key = 'WEB-2'$$, '23505');
select t.throws('a link must be https',
  $$insert into public.issue_dev_links (issue_id, kind, repo, ref, url)
    select id, 'commit', 'Elevance-Labs/site', 'abc', 'javascript:alert(1)' from public.issues where key = 'WEB-2'$$, '23514');
select t.throws('a state must be one a pull request has',
  $$insert into public.issue_dev_links (issue_id, kind, repo, ref, url, state)
    select id, 'pull_request', 'Elevance-Labs/site', '8', 'https://github.com/x', 'exploded' from public.issues where key = 'WEB-2'$$, '23514');

-- ---------------- reading ----------------
select t.login('sara');
select t.eq('a project member reads an issue''s links', (select count(*) from public.issue_dev_links), 2::bigint);

select t.login('omar');
select t.eq('so does a viewer of the project', (select count(*) from public.issue_dev_links), 2::bigint);

select t.login('hina');
select t.eq('someone outside a private project sees none of them', (select count(*) from public.issue_dev_links), 0::bigint);

select t.as_anon();
select t.throws('anon can''t read them', 'select * from public.issue_dev_links', '42501');

-- ---------------- writing: nobody signed in, whatever their role ----------------
select t.login('sara');
select t.throws('a member can''t add a link',
  $$insert into public.issue_dev_links (issue_id, kind, repo, ref, url)
    select id, 'commit', 'x/y', 'abc', 'https://github.com/x' from public.issues where key = 'WEB-2'$$, '42501');
select t.throws('…or change one', $$update public.issue_dev_links set state = 'merged'$$, '42501');
select t.throws('…or remove one', 'delete from public.issue_dev_links', '42501');

select t.login('amna');
select t.throws('nor can a workspace admin',
  $$insert into public.issue_dev_links (issue_id, kind, repo, ref, url)
    select id, 'commit', 'x/y', 'abc', 'https://github.com/x' from public.issues where key = 'WEB-2'$$, '42501');

-- ---------------- they go with the issue ----------------
select t.superuser();
delete from public.issues where key = 'WEB-2';
select t.eq('deleting the issue deletes its links', (select count(*) from public.issue_dev_links), 0::bigint);
