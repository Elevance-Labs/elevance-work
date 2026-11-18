-- Reactions on comments: a thumbs up or down, one per person per comment.
-- Anyone who reads the issue reacts; only you change or remove yours; the
-- guard stamps who and the issue; reactions go with their comment.

-- The one comment, whoever asks (outsiders can't read it).
create function t.the_comment() returns uuid language sql stable security definer as
  $$ select id from public.comments limit 1 $$;

select t.login('sara');
select t.eq('an issue', t.new_issue('WEB', 'Hero banner'), 'WEB-1');
insert into public.comments (issue_id, body) values (t.issue('WEB-1'), '<p>Ship it?</p>');

-- ---------------- reacting ----------------
insert into public.comment_reactions (comment_id, kind) values (t.the_comment(), 'up');
select t.eq('a member reacts to a comment',
  (select count(*) from public.comment_reactions where kind = 'up'), 1::bigint);
select t.eq('…the reaction is stamped as theirs', (select profile_id from public.comment_reactions), t.pid('sara'));
select t.eq('…on the comment''s issue', (select issue_id from public.comment_reactions), t.issue('WEB-1'));
select t.throws('one reaction per person per comment',
  $$insert into public.comment_reactions (comment_id, kind) values (t.the_comment(), 'down')$$, '23505');
select t.throws('only up or down',
  $$update public.comment_reactions set kind = 'heart'$$, '23514');
select t.throws('who reacted can''t be set',
  $$insert into public.comment_reactions (comment_id, profile_id, kind) values (t.the_comment(), t.pid('omar'), 'up')$$, '42501');

update public.comment_reactions set kind = 'down';
select t.eq('switching up to down changes it', (select kind from public.comment_reactions), 'down');

select t.login('omar');
insert into public.comment_reactions (comment_id, kind) values (t.the_comment(), 'up');
select t.eq('a viewer reacts too, and reads everyone''s',
  (select count(*) from public.comment_reactions), 2::bigint);
update public.comment_reactions set kind = 'up' where profile_id = t.pid('sara');
delete from public.comment_reactions where profile_id = t.pid('sara');
select t.eq('…but doesn''t change or remove someone else''s',
  (select kind from public.comment_reactions where profile_id = t.pid('sara')), 'down');

select t.login('hina');
select t.eq('someone outside a private project sees none',
  (select count(*) from public.comment_reactions), 0::bigint);
select t.throws('…and can''t react',
  $$insert into public.comment_reactions (comment_id, kind) values (t.the_comment(), 'up')$$, '42501');

select t.login('omar');
delete from public.comment_reactions;
select t.eq('taking your reaction away', (select count(*) from public.comment_reactions), 1::bigint);

select t.eq('a reaction notifies nobody', (select count(*) from t.notifications('sara')), 0::bigint);

-- ---------------- deleting the comment ----------------
select t.login('sara');
delete from public.comments where id = t.the_comment();
select t.superuser();
select t.eq('its reactions go with it', (select count(*) from public.comment_reactions), 0::bigint);
