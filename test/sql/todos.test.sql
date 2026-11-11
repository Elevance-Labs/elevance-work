-- Todos: yours, and shared with the people you add. Everyone on a todo sees,
-- edits and checks it off; only its creator deletes it.

select t.login('sara');
select t.new_issue('WEB', 'Hero image');

-- ---------------- people on a todo ----------------
insert into public.todos (title, issue_id, shared_with)
values ('Pick the photo', t.issue('WEB-1'),
        array[t.pid('omar'), t.pid('omar'), t.pid('sara'), t.pid('zara'), t.pid('hina')]);
select t.eq('a todo belongs to whoever wrote it',
  (select owner_id from public.todos where title = 'Pick the photo'), t.pid('sara'));
select t.eq('its people: active ones, each once, never its creator',
  (select array(select unnest(shared_with) order by 1) from public.todos where title = 'Pick the photo'),
  array(select unnest(array[t.pid('omar'), t.pid('hina')]) order by 1));
insert into public.todos (title) values ('Sara only');

select t.login('omar');
select t.eq('someone on a todo sees it, and only that one',
  (select string_agg(title, ',') from public.todos), 'Pick the photo');
select t.eq('…edits it', t.rows($$update public.todos set title = 'Pick the hero photo' where title = 'Pick the photo'$$), 1::bigint);
select t.eq('…checks it off', t.rows($$update public.todos set done_at = now() where title = 'Pick the hero photo'$$), 1::bigint);
update public.todos set shared_with = shared_with || t.pid('amna') where title = 'Pick the hero photo';
select t.ok('…and adds people, as its creator can',
  (select shared_with @> array[t.pid('amna')] from public.todos where title = 'Pick the hero photo'));
select t.eq('…but can''t delete it', t.rows($$delete from public.todos where title = 'Pick the hero photo'$$), 0::bigint);
select t.throws('…nor take it over', $$update public.todos set owner_id = t.pid('omar')$$, '42501');

select t.login('amna');
select t.eq('someone added sees it too', (select count(*) from public.todos), 1::bigint);
select t.eq('…while the creator''s own stay private, even from admins',
  (select count(*) from public.todos where title = 'Sara only'), 0::bigint);
select t.eq('…nor can they change them', t.rows($$update public.todos set title = 'x' where title = 'Sara only'$$), 0::bigint);

-- Leaving: taking yourself off a todo.
select t.throws('taking yourself off by an update is refused (you''d no longer see it)',
  $$update public.todos set shared_with = array_remove(shared_with, t.pid('amna'))$$, '42501');
select public.todo_leave((select id from public.todos));
select t.eq('…so someone on a todo leaves it with todo_leave', (select count(*) from public.todos), 0::bigint);

select t.login('sara');
select t.eq('…and the creator sees who is left',
  (select array(select unnest(shared_with) order by 1) from public.todos where title = 'Pick the hero photo'),
  array(select unnest(array[t.pid('omar'), t.pid('hina')]) order by 1));
update public.todos set shared_with = '{}' where title = 'Pick the hero photo';
select t.login('omar');
select t.eq('the creator can take people off', (select count(*) from public.todos), 0::bigint);

select t.login('sara');
select t.eq('only the creator deletes a todo', t.rows($$delete from public.todos where title = 'Pick the hero photo'$$), 1::bigint);

-- ---------------- issues ----------------
select t.login('hina');
select t.throws('a todo can''t be tied to an issue you can''t see',
  $$insert into public.todos (title, issue_id) values ('x', t.issue('WEB-1'))$$, '42501', 'tie a todo');

select t.login('sara');
insert into public.todos (title, shared_with) values ('Ask Hina', array[t.pid('hina')]);
select t.login('hina');
select t.eq('someone on a todo can change it without seeing its issue''s project… (no issue yet)',
  t.rows($$update public.todos set due_on = '2026-10-30'$$), 1::bigint);
select t.throws('…but can''t tie it to an issue they can''t see',
  $$update public.todos set issue_id = t.issue('WEB-1')$$, '42501');
select t.login('sara');
update public.todos set issue_id = t.issue('WEB-1') where title = 'Ask Hina';
select t.login('hina');
select t.eq('…while one tied by someone who can still reaches them',
  t.rows($$update public.todos set done_at = now()$$), 1::bigint);

-- ---------------- projects ----------------
select t.login('sara');
insert into public.todos (title, project_id) values ('Plan the launch', t.project('WEB'));
select t.eq('a todo can be tied to a project alone',
  (select project_id from public.todos where title = 'Plan the launch'), t.project('WEB'));
insert into public.todos (title, issue_id, project_id) values ('Crop it', t.issue('WEB-1'), t.project('OPS'));
select t.eq('an issue''s todo is in the issue''s project',
  (select project_id from public.todos where title = 'Crop it'), t.project('WEB'));
select t.eq('…and todos tied to an issue before had it filled in',
  (select project_id from public.todos where title = 'Ask Hina'), t.project('WEB'));

select t.login('hina');
select t.throws('a todo can''t be tied to a project you can''t see',
  $$insert into public.todos (title, project_id) values ('x', t.project('WEB'))$$, '42501', 'tie a todo to that project');
select t.eq('…but an open one is fine',
  t.rows($$insert into public.todos (title, project_id) values ('Rota', t.project('OPS'))$$), 1::bigint);

select t.as_anon();
select t.throws('nothing for the anonymous key', $$select count(*) from public.todos$$, '42501');
