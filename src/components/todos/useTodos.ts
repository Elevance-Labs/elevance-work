import { useCallback, useEffect, useState } from 'react'
import { errorMessage } from '../../lib/constants'
import { supabase } from '../../lib/supabase'
import { TODO_COLUMNS, type TodoRow } from '../../lib/todos'
import type { Todo } from '../../lib/types'
import { useItemChanges } from '../../workspace/itemEvents'
import type { NewTodo } from './TodoComposer'

/** Your todos (or one issue's) and the writes on them. onChange: after any write, for views showing the same todos. */
export function useTodos(issueId?: string, onChange?: () => void) {
  const [todos, setTodos] = useState<TodoRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    let q = supabase.from('todos').select(TODO_COLUMNS)
    if (issueId) q = q.eq('issue_id', issueId)
    const { data } = await q.order('position')
    setTodos((data ?? []) as unknown as TodoRow[])
  }, [issueId])

  useEffect(() => {
    load()
  }, [load])
  useItemChanges(['todo'], load)

  const after = (e: unknown) => {
    if (e) {
      setError(errorMessage(e as Parameters<typeof errorMessage>[0]))
      load()
    }
    onChange?.()
  }

  async function add(values: NewTodo, listId: string | null) {
    setError(null)
    const { data, error: e } = await supabase.from('todos').insert(values).select(TODO_COLUMNS).single()
    if (e || !data) {
      setError(errorMessage(e))
      return false
    }
    let row = data as unknown as TodoRow
    if (listId) {
      const { error: me } = await supabase.rpc('todo_move', { p_todo: row.id, p_list: listId })
      if (me) setError(`Added to your Inbox: ${errorMessage(me)}`)
      else row = { ...row, place: [{ list_id: listId }] }
    }
    setTodos((ts) => [...(ts ?? []), row])
    onChange?.()
    return true
  }

  async function update(t: TodoRow, patch: Partial<Todo>) {
    setTodos((ts) => ts && ts.map((x) => (x.id === t.id ? { ...x, ...patch } : x)))
    const { error: e } = await supabase.from('todos').update(patch).eq('id', t.id)
    after(e)
  }

  async function remove(t: TodoRow) {
    setTodos((ts) => ts && ts.filter((x) => x.id !== t.id))
    const { error: e } = await supabase.from('todos').delete().eq('id', t.id)
    after(e)
  }

  // Off someone else's todo: it leaves your list.
  async function leave(t: TodoRow) {
    setTodos((ts) => ts && ts.filter((x) => x.id !== t.id))
    const { error: e } = await supabase.rpc('todo_leave', { p_todo: t.id })
    after(e)
  }

  // Into one of your lists, or back to the Inbox (null); only where you see it.
  async function move(t: TodoRow, listId: string | null) {
    setTodos((ts) => ts && ts.map((x) => (x.id === t.id ? { ...x, place: listId ? [{ list_id: listId }] : [] } : x)))
    const { error: e } = await supabase.rpc('todo_move', { p_todo: t.id, p_list: listId })
    after(e)
  }

  return { todos, error, setError, load, add, update, remove, leave, move }
}

export type TodoStore = ReturnType<typeof useTodos>
