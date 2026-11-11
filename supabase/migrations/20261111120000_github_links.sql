-- GitHub links: the branches, commits and pull requests that mention an issue.
--
-- Work on an issue happens in GitHub, and until now the issue could not say
-- so. The `github` Edge Function receives the organisation's webhook, finds
-- issue keys (WEB-12) in branch names, commit messages and pull request
-- titles, and records one row per thing found, per issue. The issue view
-- lists them under Development.
--
-- Written only by that function (service role): there are no client write
-- grants at all, so nobody can claim a pull request for an issue by hand.
-- Read by whoever can see the issue, through the same `can_view_issue` every
-- other issue table uses.

create type public.dev_link_kind as enum ('branch', 'commit', 'pull_request');

-- One row per branch, commit or pull request, per issue it names.
create table public.issue_dev_links (
  id          uuid primary key default gen_random_uuid(),
  issue_id    uuid not null references public.issues (id) on delete cascade,
  kind        public.dev_link_kind not null,
  -- owner/name, as GitHub writes it.
  repo        text not null check (length(repo) between 1 and 200),
  -- What it is within the repo: the branch's name, the commit's sha, the pull request's number.
  ref         text not null check (length(ref) between 1 and 300),
  -- The pull request's title, or the first line of the commit message.
  title       text not null default '',
  url         text not null check (url like 'https://%'),
  -- Pull requests only.
  state       text check (state in ('open', 'draft', 'merged', 'closed')),
  -- A GitHub login or commit author: not one of our people.
  author      text,
  happened_at timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (issue_id, kind, repo, ref)
);

revoke all on public.issue_dev_links from anon, authenticated;
grant select on public.issue_dev_links to authenticated;

alter table public.issue_dev_links enable row level security;

create policy issue_dev_links_select on public.issue_dev_links for select to authenticated
  using (public.can_view_issue(issue_id));
