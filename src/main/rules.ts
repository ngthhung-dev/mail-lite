import type { Rule, RuleCondition } from '../shared/types.ts'

export interface RuleSubject {
  from: string
  to: string
  subject: string
  body: string
  hasAttachment: boolean
}

function test(c: RuleCondition, m: RuleSubject): boolean {
  if (c.field === 'hasAttachment') return m.hasAttachment === (c.value !== 'false')
  const hay = (m[c.field] ?? '').toLowerCase()
  const needle = c.value.toLowerCase().trim()
  if (!needle) return false
  if (c.op === 'equals') return hay === needle
  if (c.op === 'notContains') return !hay.includes(needle)
  return hay.includes(needle)
}

export function ruleMatches(rule: Rule, m: RuleSubject): boolean {
  if (!rule.enabled || rule.conditions.length === 0) return false
  return rule.match === 'any' ? rule.conditions.some((c) => test(c, m)) : rule.conditions.every((c) => test(c, m))
}
