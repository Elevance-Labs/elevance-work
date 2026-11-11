import { createContext, useContext } from 'react'
import type { CreateDefaults } from './CreateIssueDialog'

export interface LayoutActions {
  // Open the create dialog, optionally in a project, under a parent, in a sprint…
  openCreate: (defaults?: CreateDefaults) => void
}

export const LayoutContext = createContext<LayoutActions>({ openCreate: () => {} })
export const useLayout = () => useContext(LayoutContext)
