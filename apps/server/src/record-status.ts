import type { RecordStatus } from '@mikey/shared'

// A payment, income or expense has no status column: it is voided if a void points at it, void
// requested if a pending request does, otherwise posted.
export function recordStatus(row: { voidRecord: object | null; voidRequests: readonly object[] }): RecordStatus {
  if (row.voidRecord !== null) {
    return 'voided'
  }
  return row.voidRequests.length > 0 ? 'void_requested' : 'posted'
}
