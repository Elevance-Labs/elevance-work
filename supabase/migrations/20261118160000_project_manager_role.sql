-- A fourth project role, Manager, between Admin and Member.
--
-- Admin: settings (the project, people, workflow, fields, integrations,
-- features, the Summary's widgets) and everything a manager can.
-- Manager: releases (planning, notes, approvers, releasing, deleting) and
-- removing what others made (issues, comments, files, docs).
-- Member: creates and edits issues and plans sprints; no release management.
-- Viewer: reads, comments and watches.
--
-- Only the enum value here: a new enum value can't be used in the
-- transaction that adds it, so the next migration puts it to work.

alter type public.project_role add value 'manager' before 'member';
