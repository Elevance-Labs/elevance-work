// A project's custom fields: which apply to an issue type, and what counts
// as filled in (mirrors issue_custom_clean in the schema).
import type { CustomValues, Field } from './types'

type Value = CustomValues[string] | undefined

/** The fields that apply to an issue type, in order. */
export const fieldsFor = (fields: Field[], typeId: string) =>
  fields.filter((f) => !f.issue_type_ids || f.issue_type_ids.includes(typeId)).sort((a, b) => a.position - b.position)

export const isEmptyValue = (v: Value) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)

/** The required fields of a type that have no value. */
export const missingRequired = (fields: Field[], typeId: string, custom: CustomValues) =>
  fieldsFor(fields, typeId).filter((f) => f.required && f.kind !== 'checkbox' && isEmptyValue(custom[f.id]))
