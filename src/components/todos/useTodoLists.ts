import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { TodoList } from '../../lib/types'
import { useItemChanges } from '../../workspace/itemEvents'

/** Your own todo lists, in order (RLS returns only yours). Read again when a todo or list changes anywhere. */
export function useTodoLists() {
  const [lists, setLists] = useState<TodoList[] | null>(null)
  const load = useCallback(async () => {
    const { data } = await supabase.from('todo_lists').select('*').order('position')
    setLists((data ?? []) as TodoList[])
  }, [])
  useEffect(() => {
    load()
  }, [load])
  useItemChanges(['todo'], load)
  return { lists: lists ?? [], loaded: lists !== null, reload: load, setLists }
}
