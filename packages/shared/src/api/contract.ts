import { z, type ZodType } from 'zod'

import type { PermissionKey } from '../permissions.ts'
import {
  accountsResponseSchema,
  bookQuerySchema,
  bookResponseSchema,
  categoriesResponseSchema,
  dayCloseCreateSchema,
  dayCloseSchema,
  dayClosesResponseSchema,
  dayCloseStatusSchema,
  moneyEntryCreateSchema,
  moneyEntryListQuerySchema,
  moneyEntryListResponseSchema,
  moneyEntrySchema,
  transferCreateSchema,
  transferSchema,
} from './accounts.ts'
import { attendanceSummaryQuerySchema, attendanceSummarySchema } from './attendance.ts'
import { loginRequestSchema, loginResponseSchema, sessionSchema } from './auth.ts'
import { adDateSchema, idSchema } from './common.ts'
import { financeDashboardSchema, schoolDashboardSchema } from './dashboard.ts'
import {
  collectPaymentRequestSchema,
  collectPaymentResponseSchema,
  originalPrintAllowanceSchema,
  paymentsListQuerySchema,
  paymentsListResponseSchema,
  receiptSchema,
  studentDuesResponseSchema,
  voidApprovalSchema,
  voidDeclineSchema,
  voidRequestCreateSchema,
  voidRequestSchema,
  voidRequestsResponseSchema,
} from './fees.ts'
import { reportQuerySchema, reportSchema } from './reports.ts'
import { studentFeesSchema, studentSearchQuerySchema, studentSearchResponseSchema } from './students.ts'
import {
  allowedComputerCreateSchema,
  allowedComputerSchema,
  classesResponseSchema,
  connectionRequestCreateSchema,
  connectionRequestResponseSchema,
  connectionsResponseSchema,
  healthResponseSchema,
  schoolResponseSchema,
} from './system.ts'

export const API_PREFIX = '/api/v1'

// anyone, local_network and allowed_computer work without a session; optional_sign_in answers an
// allowed computer and says more when its session is valid. Everything except anyone and
// local_network needs an allowed computer.
export type Access = PermissionKey | 'anyone' | 'local_network' | 'allowed_computer' | 'optional_sign_in' | 'signed_in'

export interface Endpoint {
  readonly method: 'GET' | 'POST'
  readonly path: `/${string}`
  readonly access: Access
  readonly params?: ZodType
  readonly query?: ZodType
  readonly body?: ZodType
  readonly response: ZodType | 'pdf' | 'xlsx' | 'empty'
}

const requestParams = z.object({ requestId: idSchema })
const computerParams = z.object({ computerId: idSchema })
const studentParams = z.object({ studentId: idSchema })
const paymentParams = z.object({ paymentId: idSchema })
const accountParams = z.object({ accountId: idSchema })
const dateParams = z.object({ date: adDateSchema })

export const endpoints = {
  health: { method: 'GET', path: '/health', access: 'anyone', response: healthResponseSchema },
  requestConnection: {
    method: 'POST',
    path: '/connection-requests',
    access: 'local_network',
    body: connectionRequestCreateSchema,
    response: connectionRequestResponseSchema,
  },
  login: {
    method: 'POST',
    path: '/auth/login',
    access: 'allowed_computer',
    body: loginRequestSchema,
    response: loginResponseSchema,
  },
  session: { method: 'GET', path: '/auth/session', access: 'signed_in', response: sessionSchema },
  logout: { method: 'POST', path: '/auth/logout', access: 'signed_in', response: 'empty' },
  listConnections: {
    method: 'GET',
    path: '/connection-requests',
    access: 'settings.manage',
    response: connectionsResponseSchema,
  },
  allowConnection: {
    method: 'POST',
    path: '/connection-requests/:requestId/allow',
    access: 'settings.manage',
    params: requestParams,
    response: allowedComputerSchema,
  },
  declineConnection: {
    method: 'POST',
    path: '/connection-requests/:requestId/decline',
    access: 'settings.manage',
    params: requestParams,
    response: 'empty',
  },
  addAllowedComputer: {
    method: 'POST',
    path: '/allowed-computers',
    access: 'settings.manage',
    body: allowedComputerCreateSchema,
    response: allowedComputerSchema,
  },
  removeAllowedComputer: {
    method: 'POST',
    path: '/allowed-computers/:computerId/remove',
    access: 'settings.manage',
    params: computerParams,
    response: 'empty',
  },
  schoolProfile: { method: 'GET', path: '/school', access: 'optional_sign_in', response: schoolResponseSchema },
  classes: { method: 'GET', path: '/classes', access: 'signed_in', response: classesResponseSchema },

  financeDashboard: {
    method: 'GET',
    path: '/dashboard/finance',
    access: 'dashboard.finance',
    response: financeDashboardSchema,
  },
  schoolDashboard: {
    method: 'GET',
    path: '/dashboard/school',
    access: 'dashboard.school',
    response: schoolDashboardSchema,
  },

  searchStudents: {
    method: 'GET',
    path: '/students',
    access: 'students.view',
    query: studentSearchQuerySchema,
    response: studentSearchResponseSchema,
  },
  studentFees: {
    method: 'GET',
    path: '/students/:studentId/fees',
    access: 'students.view',
    params: studentParams,
    response: studentFeesSchema,
  },
  studentDues: {
    method: 'GET',
    path: '/students/:studentId/dues',
    access: 'fees.collect',
    params: studentParams,
    response: studentDuesResponseSchema,
  },

  collectPayment: {
    method: 'POST',
    path: '/payments',
    access: 'fees.collect',
    body: collectPaymentRequestSchema,
    response: collectPaymentResponseSchema,
  },
  printReceipt: {
    method: 'POST',
    path: '/payments/:paymentId/print',
    access: 'fees.collect',
    params: paymentParams,
    response: 'pdf',
  },
  reprintReceipt: {
    method: 'POST',
    path: '/payments/:paymentId/reprint',
    access: 'payments.reprint',
    params: paymentParams,
    response: 'pdf',
  },
  testReceipt: { method: 'GET', path: '/receipts/test', access: 'fees.collect', response: 'pdf' },
  listPayments: {
    method: 'GET',
    path: '/payments',
    access: 'payments.view',
    query: paymentsListQuerySchema,
    response: paymentsListResponseSchema,
  },
  getPayment: {
    method: 'GET',
    path: '/payments/:paymentId',
    access: 'payments.view',
    params: paymentParams,
    response: receiptSchema,
  },
  requestVoid: {
    method: 'POST',
    path: '/void-requests',
    access: 'payments.requestVoid',
    body: voidRequestCreateSchema,
    response: voidRequestSchema,
  },
  listMyVoidRequests: {
    method: 'GET',
    path: '/void-requests',
    access: 'payments.requestVoid',
    response: voidRequestsResponseSchema,
  },
  listPendingVoidRequests: {
    method: 'GET',
    path: '/void-requests/pending',
    access: 'payments.void',
    response: voidRequestsResponseSchema,
  },
  voidDirectly: {
    method: 'POST',
    path: '/voids',
    access: 'payments.void',
    body: voidRequestCreateSchema,
    response: voidRequestSchema,
  },
  approveVoid: {
    method: 'POST',
    path: '/void-requests/:requestId/approve',
    access: 'payments.void',
    params: requestParams,
    body: voidApprovalSchema,
    response: voidRequestSchema,
  },
  declineVoid: {
    method: 'POST',
    path: '/void-requests/:requestId/decline',
    access: 'payments.void',
    params: requestParams,
    body: voidDeclineSchema,
    response: voidRequestSchema,
  },
  allowOriginalPrint: {
    method: 'POST',
    path: '/payments/:paymentId/allow-original',
    access: 'payments.void',
    params: paymentParams,
    body: originalPrintAllowanceSchema,
    response: 'empty',
  },

  expenseCategories: {
    method: 'GET',
    path: '/expense-categories',
    access: 'accounts.view',
    response: categoriesResponseSchema,
  },
  incomeCategories: {
    method: 'GET',
    path: '/income-categories',
    access: 'accounts.view',
    response: categoriesResponseSchema,
  },
  listExpenses: {
    method: 'GET',
    path: '/expenses',
    access: 'accounts.view',
    query: moneyEntryListQuerySchema,
    response: moneyEntryListResponseSchema,
  },
  createExpense: {
    method: 'POST',
    path: '/expenses',
    access: 'expense.create',
    body: moneyEntryCreateSchema,
    response: moneyEntrySchema,
  },
  listIncomes: {
    method: 'GET',
    path: '/incomes',
    access: 'accounts.view',
    query: moneyEntryListQuerySchema,
    response: moneyEntryListResponseSchema,
  },
  createIncome: {
    method: 'POST',
    path: '/incomes',
    access: 'income.create',
    body: moneyEntryCreateSchema,
    response: moneyEntrySchema,
  },
  listAccounts: { method: 'GET', path: '/accounts', access: 'accounts.view', response: accountsResponseSchema },
  accountBook: {
    method: 'GET',
    path: '/accounts/:accountId/book',
    access: 'accounts.view',
    params: accountParams,
    query: bookQuerySchema,
    response: bookResponseSchema,
  },
  createTransfer: {
    method: 'POST',
    path: '/transfers',
    access: 'accounts.transfer',
    body: transferCreateSchema,
    response: transferSchema,
  },
  dayCloseStatus: {
    method: 'GET',
    path: '/day-closes/:date',
    access: 'accounts.dayClose',
    params: dateParams,
    response: dayCloseStatusSchema,
  },
  closeDay: {
    method: 'POST',
    path: '/day-closes',
    access: 'accounts.dayClose',
    body: dayCloseCreateSchema,
    response: dayCloseSchema,
  },
  listDayCloses: {
    method: 'GET',
    path: '/day-closes',
    access: 'accounts.dayClose',
    response: dayClosesResponseSchema,
  },
  printDayClose: {
    method: 'POST',
    path: '/day-closes/:date/print',
    access: 'accounts.dayClose',
    params: dateParams,
    response: 'pdf',
  },

  report: { method: 'GET', path: '/reports', access: 'reports.finance', query: reportQuerySchema, response: reportSchema },
  reportPdf: { method: 'GET', path: '/reports/pdf', access: 'reports.finance', query: reportQuerySchema, response: 'pdf' },
  reportExcel: {
    method: 'GET',
    path: '/reports/xlsx',
    access: 'reports.finance',
    query: reportQuerySchema,
    response: 'xlsx',
  },

  attendanceSummary: {
    method: 'GET',
    path: '/attendance/summary',
    access: 'attendance.view',
    query: attendanceSummaryQuerySchema,
    response: attendanceSummarySchema,
  },
} as const satisfies Record<string, Endpoint>

export type EndpointName = keyof typeof endpoints
