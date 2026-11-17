-- Project features and the Summary's widgets.
--
-- disabled_features: the parts of a project its admins have turned off
-- (Timeline, Calendar, Issues, Board, Releases, Docs). Opt-out, so every
-- existing project, and any feature added later, starts on. One of Issues and
-- Board always stays on: a project needs somewhere to see its issues. Turning
-- a feature off only hides it in the app; no data changes (an issue keeps
-- its release while Releases is off) and access is unchanged.
--
-- summary_widgets: which widgets the project's Summary shows, in order. Null
-- is the default for the project's kind. The database checks only the shape
-- of the keys, not their names, so a new widget needs no migration; the app
-- ignores keys it doesn't know.
--
-- Both are written by project admins only: the existing projects_update
-- policy (can_admin_project) already says so.

alter table public.projects
  add column disabled_features text[] not null default '{}'
    constraint projects_disabled_features_check check (
      disabled_features <@ array['timeline', 'calendar', 'issues', 'board', 'releases', 'docs']
      and not disabled_features @> array['issues', 'board']),
  add column summary_widgets text[]
    constraint projects_summary_widgets_check check (
      summary_widgets is null
      or cardinality(summary_widgets) = 0
      or (cardinality(summary_widgets) <= 30
          and array_position(summary_widgets, null) is null
          and array_to_string(summary_widgets, ',') ~ '^[a-z_]{1,40}(,[a-z_]{1,40})*$'));

grant update (disabled_features, summary_widgets) on public.projects to authenticated;
