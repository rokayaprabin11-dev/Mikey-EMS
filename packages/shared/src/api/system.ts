import { z } from 'zod'

import { idSchema, timestampSchema } from './common.ts'

export const healthResponseSchema = z.object({
  server: z.literal('ok'),
  db: z.enum(['ok', 'down']),
  device: z.enum(['connected', 'not_responding', 'none']),
  cloudBackup: z.enum(['uploaded', 'waiting', 'failed', 'not_set_up']),
  allowed: z.boolean(),
  time: timestampSchema,
  serverName: z.string(),
  schoolName: z.string().nullable(),
})

export const connectionRequestCreateSchema = z.object({
  computerName: z.string().trim().min(1).max(63),
  askAgain: z.boolean().default(false),
})

export const connectionRequestResponseSchema = z.object({
  ip: z.union([z.ipv4(), z.ipv6()]),
  status: z.enum(['pending', 'allowed', 'declined']),
})

export const schoolProfileSchema = z.object({
  name: z.string(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  pan: z.string().nullable(),
})

export const classesResponseSchema = z.object({
  classes: z.array(
    z.object({
      id: idSchema,
      name: z.string(),
      sections: z.array(z.object({ id: idSchema, name: z.string() })),
    }),
  ),
})

export type HealthResponse = z.infer<typeof healthResponseSchema>
export type ConnectionRequestCreate = z.infer<typeof connectionRequestCreateSchema>
export type ConnectionRequestResponse = z.infer<typeof connectionRequestResponseSchema>
export type SchoolProfile = z.infer<typeof schoolProfileSchema>
export type ClassesResponse = z.infer<typeof classesResponseSchema>
