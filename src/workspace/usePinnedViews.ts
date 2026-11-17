// Your pinned views: saved filters (yours or shared) pinned to the navigation,
// under Issues. A pin whose filter you can no longer read (deleted, or
// unshared by its owner) is left out. Pinning from the Issues page tells the
// navigation through itemEvents.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { errorMessage } from '../lib/constants'
import type { SavedFilter } from '../lib/types'
import { emitItemChange, useItemChanges } from './itemEvents'

export interface PinnedView {
  filter_id: string
  position: number
  filter: SavedFilter
}

export function usePinnedViews() {
  const [views, setViews] = useState<PinnedView[]>([])
  const load = useCallback(async () => {
    const { data } = await supabase.from('saved_filter_pins').select('filter_id, position, filter:saved_filters(*)').order('position')
    const rows = (data ?? []) as unknown as (Omit<PinnedView, 'filter'> & { filter: SavedFilter | null })[]
    setViews(rows.filter((r): r is PinnedView => !!r.filter))
  }, [])
  useEffect(() => {
    load()
  }, [load])
  useItemChanges(['view'], load)
  return views
}

/** Pins (or unpins) a saved filter; returns an error message, if any. */
export async function setPinned(filterId: string, pinned: boolean): Promise<string | null> {
  const { error } = pinned
    ? await supabase.from('saved_filter_pins').insert({ filter_id: filterId })
    : await supabase.from('saved_filter_pins').delete().eq('filter_id', filterId)
  emitItemChange('view')
  return error ? errorMessage(error) : null
}
