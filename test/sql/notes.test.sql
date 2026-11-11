-- Notes and note labels: private to their owner, labels per person, links to
-- projects and Google Calendar meetings, pinning.

-- ---------------- labels ----------------
select t.login('sara');
insert into public.note_labels (name) values ('  Ideas '), ('Clients');
select t.eq('a label belongs to whoever made it, its name trimmed',
  (select owner_id::text || ':' || name from public.note_labels where name = 'Ideas'), t.pid('sara')::text || ':Ideas');
select t.throws('label names are unique per person, ignoring case',
  $$insert into public.note_labels (name) values ('IDEAS')$$, '23505');
select t.throws('a label needs a name', $$insert into public.note_labels (name) values ('  ')$$, '23514');

select t.login('omar');
insert into public.note_labels (name) values ('Ideas');
select t.eq('…but two people may each have the same one', (select count(*) from public.note_labels), 1::bigint);
-- Omar's label, to try on Sara's note.
select t.superuser();
select set_config('test.omar_label', (select id::text from public.note_labels where owner_id = t.pid('omar')), false);

-- ---------------- notes ----------------
select t.login('sara');
insert into public.notes (title, body, label_ids, project_id)
values ('  Launch plan ', 'Hero first, then pricing.',
        array[(select id from public.note_labels where name = 'Ideas'),
              (select id from public.note_labels where name = 'Ideas'),
              current_setting('test.omar_label')::uuid],
        t.project('WEB'));
select t.eq('a note belongs to whoever wrote it, yellow unless chosen, its title trimmed',
  (select owner_id::text || ':' || color || ':' || title from public.notes),
  t.pid('sara')::text || ':yellow:Launch plan');
select t.eq('only your own labels stick, once each',
  (select label_ids from public.notes), array[(select id from public.note_labels where name = 'Ideas')]);

select t.throws('a note needs a title or some text',
  $$insert into public.notes (title, body) values (' ', '')$$, '23514');
select t.throws('only the listed colours', $$insert into public.notes (body, color) values ('x', 'neon')$$, '22P02');
select t.throws('the owner can''t be chosen', $$insert into public.notes (body, owner_id) values ('x', t.pid('omar'))$$, '42501');
select t.throws('…nor updated_at', $$update public.notes set updated_at = now() - interval '1 day'$$, '42501');

insert into public.notes (body, meeting_title, meeting_on) values ('Standup notes', 'Standup', '2026-10-21');
select t.eq('a meeting''s title and day without the meeting are dropped',
  (select coalesce(meeting_title, 'none') || ':' || coalesce(meeting_on::text, 'none') from public.notes where body = 'Standup notes'),
  'none:none');

-- A meeting from Sara's Google Calendar: one occurrence of a repeating one.
update public.notes set meeting_id = 'standup_20261021T050000Z', meeting_title = '  Standup ', meeting_on = '2026-10-21'
 where body = 'Standup notes';
select t.eq('a note can be about one meeting, its title and day kept to show',
  (select meeting_title || ':' || meeting_on from public.notes where body = 'Standup notes'), 'Standup:2026-10-21');
select t.throws('a meeting has one note of yours',
  $$insert into public.notes (body, meeting_id) values ('Again', 'standup_20261021T050000Z')$$, '23505');
select t.eq('…but the next day''s is another meeting',
  t.rows($$insert into public.notes (body, meeting_id) values ('Thursday', 'standup_20261022T050000Z')$$), 1::bigint);
select t.throws('a meeting id isn''t empty', $$insert into public.notes (body, meeting_id) values ('x', '')$$, '23514');

-- updated_at moves with the text, not with colour, labels or links.
select t.superuser();
update public.notes set updated_at = '2026-01-01' where title = 'Launch plan';
select t.login('sara');
update public.notes set color = 'blue', label_ids = '{}', pinned = true where title = 'Launch plan';
select t.eq('changing colour, labels or pinning doesn''t count as an edit',
  (select updated_at from public.notes where title = 'Launch plan'), '2026-01-01'::timestamptz);
update public.notes set body = 'Pricing first.' where title = 'Launch plan';
select t.ok('changing the text does', (select updated_at > '2026-01-01' from public.notes where title = 'Launch plan'));

-- ---------------- privacy ----------------
select t.login('amna');
select t.eq('notes are private, even from admins', (select count(*) from public.notes), 0::bigint);
select t.eq('…and so are labels', (select count(*) from public.note_labels), 0::bigint);
select t.eq('…nor can they change them', t.rows($$update public.notes set title = 'Mine now'$$), 0::bigint);
select t.eq('…or delete them', t.rows($$delete from public.notes$$), 0::bigint);
select t.eq('…or touch someone''s labels', t.rows($$delete from public.note_labels$$), 0::bigint);

select t.login('omar');
select t.eq('someone else at the same meeting keeps their own note on it',
  t.rows($$insert into public.notes (body, meeting_id) values ('My take', 'standup_20261021T050000Z')$$), 1::bigint);

select t.as_anon();
select t.throws('nothing for the anonymous key', $$select count(*) from public.notes$$, '42501');

-- ---------------- projects ----------------
select t.login('hina');
select t.throws('a note can''t be linked to a project you can''t see',
  $$insert into public.notes (body, project_id) values ('x', t.project('WEB'))$$, '42501', 'link a note');
select t.eq('…but an open one is fine',
  t.rows($$insert into public.notes (body, project_id) values ('Ops thoughts', t.project('OPS'))$$), 1::bigint);

-- ---------------- removing things ----------------
select t.login('sara');
update public.notes set label_ids = array[(select id from public.note_labels where name = 'Clients')] where title = 'Launch plan';
select t.superuser();
update public.notes set updated_at = '2026-01-01' where title = 'Launch plan';
select t.login('sara');
delete from public.note_labels where name = 'Clients';
select t.eq('removing a label takes it off your notes, which stay',
  (select label_ids from public.notes where title = 'Launch plan'), '{}'::uuid[]);
select t.eq('…without counting as an edit',
  (select updated_at from public.notes where title = 'Launch plan'), '2026-01-01'::timestamptz);

update public.notes set meeting_id = null where body = 'Standup notes';
select t.eq('unlinking a meeting drops its title and day',
  (select coalesce(meeting_title, 'none') || ':' || coalesce(meeting_on::text, 'none') from public.notes where body = 'Standup notes'),
  'none:none');
