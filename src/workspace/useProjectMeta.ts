// A project's members, custom fields, sprints and releases: what the issue
// view, the create dialog and the planning pages need about a project. Held
// per project for the session and shared between pages; whatever changes one
// calls `invalidateProjectMeta` so every reader reloads.
import { useEffect, useSyncExternalStore } from 'react'
import { supabase } from '../lib/supabase'
import type { Field, ProjectMember, Release, Sprint } from '../lib/types'

export interface ProjectMeta {
  members: ProjectMember[]
  fields: Field[]
  // Every sprint, oldest first.
  sprints: Sprint[]
  // Every release, by release date (undated last).
  releases: Release[]
}

const cache = new Map<string, ProjectMeta>()
const pending = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()
let version = 0

function notify() {
  version++
  for (const l of listeners) l()
}

async function load(projectId: string) {
  const [members, fields, sprints, releases] = await Promise.all([
    supabase.from('project_members').select('*').eq('project_id', projectId),
    supabase.from('fields').select('*').eq('project_id', projectId).order('position'),
    supabase.from('sprints').select('*').eq('project_id', projectId).order('created_at'),
    supabase.from('releases').select('*').eq('project_id', projectId).order('created_at'),
  ])
  cache.set(projectId, {
    members: (members.data ?? []) as ProjectMember[],
    fields: (fields.data ?? []) as Field[],
    sprints: (sprints.data ?? []) as Sprint[],
    releases: ((releases.data ?? []) as Release[]).sort((a, b) =>
      (a.release_date ?? '9999').localeCompare(b.release_date ?? '9999') || a.name.localeCompare(b.name)),
  })
  pending.delete(projectId)
  notify()
}

function ensure(projectId: string) {
  if (!cache.has(projectId) && !pending.has(projectId)) pending.set(projectId, load(projectId))
  return pending.get(projectId) ?? Promise.resolve()
}

/** Reload a project's meta everywhere it is shown. */
export function invalidateProjectMeta(projectId: string) {
  cache.delete(projectId)
  pending.delete(projectId)
  return ensure(projectId)
}

/** Forget everything (sign-out, and between tests). */
export function clearProjectMeta() {
  cache.clear()
  pending.clear()
  notify()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useProjectMeta(projectId: string | null | undefined): ProjectMeta | null {
  useSyncExternalStore(subscribe, () => version)
  useEffect(() => {
    if (projectId) ensure(projectId)
  }, [projectId])
  return projectId ? cache.get(projectId) ?? null : null
}

/** Sprints that can still take issues (active first, then planned in order). */
export const openSprints = (meta: ProjectMeta | null) =>
  (meta?.sprints ?? []).filter((s) => s.state !== 'closed').sort((a, b) => Number(b.state === 'active') - Number(a.state === 'active'))
