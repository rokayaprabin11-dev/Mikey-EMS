import { z } from 'zod'

import { idSchema, timestampSchema } from './common.ts'

export const healthResponseSchema = z.object({
  server: z.literal('ok'),
  db: z.enum(['ok', 'down']),
  device: z.enum(['connected', 'not_responding', 'none']),
  cloudBackup: z.enum(['uploaded', 'waiting', 'failed', 'not_set_up']),
  allowed: z.boolean(),
  time: timestampSchema,
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
export type SchoolProfile = z.infer<typeof schoolProfileSchema>
export type ClassesResponse = z.infer<typeof classesResponseSchema>
