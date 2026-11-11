import { PageHeader } from '../components/common'
import IssueSearch from '../components/IssueSearch'

export default function Issues() {
  return (
    <>
      <PageHeader title="Issues" subtitle="Every issue you can see, across projects. Filters stay in the address, so you can share them." />
      <IssueSearch />
    </>
  )
}
