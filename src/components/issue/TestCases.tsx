// An issue's test cases: the ones written for it, as the same sheet as the
// project's Tests tab, with how they stand. Mounted while folded away (the
// issue view's quick-add buttons), to know whether there are any; drawn
// once there are, or once asked for.
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Box, Button, Stack } from '@mui/material'
import { can } from '../../lib/permissions'
import { ISSUE_SHEET, testCounts } from '../../lib/testCases'
import type { Project, ProjectRole } from '../../lib/types'
import { Section } from '../common'
import TestSheet from '../tests/TestSheet'
import { CountsBar, EnvironmentSelect } from '../tests/TestBits'
import { useEnvironment } from '../tests/useEnvironment'
import { isTmp, useTestCases } from '../tests/useTestCases'

export default function IssueTestCases({ issue, project, role, shown, autoStart = false, onCount }: {
  issue: { id: string; key: string }
  project: Project
  role: ProjectRole | null
  /** Drawn (the issue view folds an empty section away). */
  shown: boolean
  /** Asked for from the quick-add button: open on a new case's summary. */
  autoStart?: boolean
  /** How many there are, once loaded. */
  onCount?: (n: number) => void
}) {
  const editable = can.editTests(role)
  const data = useTestCases(project.id, issue.id)
  const [env, setEnv] = useEnvironment(project)
  const cases = data.cases
  const saved = (cases ?? []).filter((c) => !isTmp(c.id))

  useEffect(() => {
    if (cases) onCount?.(cases.filter((c) => !isTmp(c.id)).length)
  }, [cases, onCount])

  if (!shown || cases === null) return null

  return (
    <Section
      title={`Test cases (${saved.length})`}
      action={
        <Button size="small" component={Link} to={`/projects/${project.key}/tests?for=${issue.key}`}>Open in Tests</Button>
      }
    >
      <Stack direction="row" spacing={1.5} sx={{ mb: 1, alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
        <CountsBar counts={testCounts(saved)} width={120} />
        <Box sx={{ flexGrow: 1 }} />
        {editable && <EnvironmentSelect project={project} value={env} onChange={setEnv} />}
      </Stack>
      {data.error && <Alert severity="error" onClose={() => data.setError(null)} sx={{ mb: 1 }}>{data.error}</Alert>}
      <TestSheet project={project} editable={editable} data={data} rows={cases} columns={ISSUE_SHEET} environment={env}
        label={`Test cases of ${issue.key}`} maxHeight={440} autoStart={autoStart && !cases.length} />
    </Section>
  )
}
