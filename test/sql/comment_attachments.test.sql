-- Files added with a comment: ordinary attachments that name the comment.
-- Written only by the drive function (service role); the database keeps a
-- file's comment on the file's own issue, and deleting the comment leaves the
-- file on the issue.

select t.login('sara');
select t.eq('an issue', t.new_issue('WEB', 'Hero banner'), 'WEB-1');
select t.eq('…and another', t.new_issue('WEB', 'Footer'), 'WEB-2');
insert into public.comments (issue_id, body) values (t.issue('WEB-1'), '<p>Screenshot attached</p>');

select t.superuser();
insert into public.attachments (issue_id, drive_file_id, file_name, mime_type, size_bytes, web_view_link, uploaded_by, comment_id)
select t.issue('WEB-1'), 'f-1', 'shot.png', 'image/png', 10, 'https://drive.google.com/f-1', t.pid('sara'), c.id
  from public.comments c where c.issue_id = t.issue('WEB-1');
select t.eq('the function records a file with its comment',
  (select count(*) from public.attachments where comment_id is not null), 1::bigint);
select t.throws('…but not with a comment on another issue',
  $$insert into public.attachments (issue_id, drive_file_id, file_name, mime_type, size_bytes, web_view_link, comment_id)
    select t.issue('WEB-2'), 'f-2', 'x.png', 'image/png', 1, 'https://drive.google.com/f-2', c.id
      from public.comments c where c.issue_id = t.issue('WEB-1')$$, '23503');

-- ---------------- reading and writing ----------------
select t.login('omar');
select t.eq('a viewer of the project reads which comment a file came with',
  (select count(*) from public.attachments where comment_id is not null), 1::bigint);

select t.login('hina');
select t.eq('someone outside a private project sees none of them', (select count(*) from public.attachments), 0::bigint);

select t.login('sara');
select t.throws('nobody signed in moves a file to another comment',
  $$update public.attachments set comment_id = null$$, '42501');

-- ---------------- deleting the comment ----------------
delete from public.comments where issue_id = t.issue('WEB-1');
select t.superuser();
select t.eq('deleting the comment keeps its file on the issue',
  (select count(*) from public.attachments where issue_id = t.issue('WEB-1')), 1::bigint);
select t.eq('…no longer with the comment',
  (select comment_id is null from public.attachments where drive_file_id = 'f-1'), true);
