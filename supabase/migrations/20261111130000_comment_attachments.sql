-- Comment attachments: files added with a comment.
--
-- A comment can now carry files. They are ordinary issue attachments (the
-- same Drive folder, the same `drive` function, the same rule that only
-- people who can edit the issue add files), marked with the comment they
-- came with so the comment can show them.
--
-- The foreign key goes through (comment_id, issue_id), so a file can only
-- point at a comment on its own issue. Deleting the comment unmarks its files
-- (they stay on the issue, and in Drive) rather than deleting the rows and
-- leaving the files behind in Drive.
--
-- Attachments still have no client write grants: only the function sets
-- comment_id, and it checks that the comment is the caller's own.

alter table public.comments add constraint comments_id_issue_key unique (id, issue_id);

alter table public.attachments add column comment_id uuid;
alter table public.attachments add constraint attachments_comment_fkey
  foreign key (comment_id, issue_id) references public.comments (id, issue_id) on delete set null (comment_id);

create index attachments_comment_idx on public.attachments (comment_id) where comment_id is not null;
