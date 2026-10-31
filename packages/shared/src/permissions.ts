import { z } from 'zod'

export const PERMISSION_KEYS = [
  'dashboard.school',
  'dashboard.finance',
  'students.view',
  'students.viewPersonal',
  'students.create',
  'students.edit',
  'students.deactivate',
  'staff.view',
  'staff.create',
  'staff.edit',
  'fees.collect',
  'fees.structure',
  'fees.discount',
  'fees.waiveFine',
  'payments.view',
  'payments.reprint',
  'payments.requestVoid',
  'payments.void',
  'income.create',
  'expense.create',
  'accounts.categories',
  'accounts.view',
  'accounts.transfer',
  'accounts.dayClose',
  'reports.finance',
  'reports.attendance',
  'attendance.view',
  'attendance.correct',
  'attendance.rules',
  'devices.manage',
  'users.manage',
  'backup.manage',
  'backup.restore',
  'audit.view',
  'settings.manage',
] as const

export type PermissionKey = (typeof PERMISSION_KEYS)[number]

export const permissionKeySchema = z.enum(PERMISSION_KEYS)

export const ROLES = ['super_admin', 'accountant'] as const

export type Role = (typeof ROLES)[number]

export const roleSchema = z.enum(ROLES)

export const SUPER_ADMIN_ONLY_PERMISSIONS = ['backup.restore', 'users.manage'] as const satisfies readonly PermissionKey[]

export const ACCOUNTANT_DEFAULT_PERMISSIONS = [
  'dashboard.finance',
  'students.view',
  'staff.view',
  'fees.collect',
  'payments.view',
  'payments.reprint',
  'payments.requestVoid',
  'income.create',
  'expense.create',
  'accounts.view',
  'accounts.transfer',
  'accounts.dayClose',
  'reports.finance',
  'attendance.view',
] as const satisfies readonly PermissionKey[]
