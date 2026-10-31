import { z } from 'zod'

import { permissionKeySchema, roleSchema } from '../permissions.ts'
import { idSchema } from './common.ts'

export const loginRequestSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200),
})

export const currentUserSchema = z.object({
  id: idSchema,
  username: z.string(),
  fullName: z.string(),
  role: roleSchema,
  permissions: z.array(permissionKeySchema),
})

export const sessionSchema = z.object({
  user: currentUserSchema,
  idleTimeoutMinutes: z.int().positive(),
})

export const loginResponseSchema = sessionSchema.extend({
  token: z.string().min(1),
})

export type LoginRequest = z.infer<typeof loginRequestSchema>
export type CurrentUser = z.infer<typeof currentUserSchema>
export type Session = z.infer<typeof sessionSchema>
export type LoginResponse = z.infer<typeof loginResponseSchema>
