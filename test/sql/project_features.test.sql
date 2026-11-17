-- Project features (what a project's admins have turned off) and the
-- Summary's widgets: both are written by project admins only, and checked.

-- Sara administers OPS (not a workspace admin); she is a member of WEB.
select t.superuser();
update public.project_members set role = 'admin' where project_id = t.project('OPS') and profile_id = t.pid('sara');

select t.login('sara');
select t.eq('every feature starts on',
  (select disabled_features from public.projects where key = 'OPS'), '{}'::text[]);
select t.eq('a project admin turns features off',
  t.rows($$update public.projects set disabled_features = '{releases,docs,timeline}' where key = 'OPS'$$), 1::bigint);
select t.eq('…and back on',
  t.rows($$update public.projects set disabled_features = '{board}' where key = 'OPS'$$), 1::bigint);
select t.throws('Issues and Board can''t both be off',
  $$update public.projects set disabled_features = '{issues,board}' where key = 'OPS'$$, '23514');
select t.throws('only known features can be turned off',
  $$update public.projects set disabled_features = '{summary}' where key = 'OPS'$$, '23514');
select t.throws('…and none of them null',
  $$update public.projects set disabled_features = array[null::text] where key = 'OPS'$$, '23514');

select t.eq('a project admin chooses the widgets',
  t.rows($$update public.projects set summary_widgets = '{release,attention,flow}' where key = 'OPS'$$), 1::bigint);
select t.eq('…in their order', (select summary_widgets from public.projects where key = 'OPS'),
  '{release,attention,flow}'::text[]);
select t.eq('…or none at all', t.rows($$update public.projects set summary_widgets = '{}' where key = 'OPS'$$), 1::bigint);
select t.eq('…or back to the default', t.rows($$update public.projects set summary_widgets = null where key = 'OPS'$$), 1::bigint);
select t.throws('a widget key is lower-case words',
  $$update public.projects set summary_widgets = '{"Release; drop"}' where key = 'OPS'$$, '23514');
select t.throws('…never empty',
  $$update public.projects set summary_widgets = '{release,""}' where key = 'OPS'$$, '23514');
select t.throws('…nor null',
  $$update public.projects set summary_widgets = array['release', null] where key = 'OPS'$$, '23514');
select t.throws('at most thirty widgets',
  $$update public.projects set summary_widgets = array_fill('flow'::text, array[31]) where key = 'OPS'$$, '23514');

select t.eq('a member can''t change features',
  t.rows($$update public.projects set disabled_features = '{docs}' where key = 'WEB'$$), 0::bigint);
select t.eq('…nor the widgets',
  t.rows($$update public.projects set summary_widgets = '{flow}' where key = 'WEB'$$), 0::bigint);

select t.login('amna');
select t.eq('a workspace admin can, anywhere',
  t.rows($$update public.projects set disabled_features = '{calendar}', summary_widgets = '{people}' where key = 'WEB'$$), 1::bigint);

select t.login('omar');
select t.eq('everyone who sees the project reads them',
  (select (disabled_features, summary_widgets)::text from public.projects where key = 'WEB'), '({calendar},{people})');
