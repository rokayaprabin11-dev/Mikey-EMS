import { z } from 'zod'

import { idSchema, ipSchema, timestampSchema } from './common.ts'

// Everything except the clock and the computer name comes from the database, so a reply with
// db "down" leaves it out rather than guess.
export const healthResponseSchema = z.discriminatedUnion('db', [
  z.object({
    server: z.literal('ok'),
    db: z.literal('ok'),
    device: z.enum(['connected', 'not_responding', 'none']),
    // The last pull that brought scans in, and the last time the server tried at all.
    lastSyncAt: timestampSchema.nullable(),
    lastAttemptAt: timestampSchema.nullable(),
    cloudBackup: z.enum(['uploaded', 'waiting', 'failed', 'not_set_up']),
    allowed: z.boolean(),
    time: timestampSchema,
    serverName: z.string(),
    schoolName: z.string().nullable(),
  }),
  z.object({
    server: z.literal('ok'),
    db: z.literal('down'),
    time: timestampSchema,
    serverName: z.string(),
  }),
])

export const connectionRequestCreateSchema = z.object({
  computerName: z.string().trim().min(1).max(63),
  askAgain: z.boolean().default(false),
})

export const connectionRequestResponseSchema = z.object({
  ip: ipSchema,
  status: z.enum(['pending', 'allowed', 'declined']),
})

export const allowedComputerSchema = z.object({
  id: idSchema,
  ip: ipSchema,
  computerName: z.string(),
  allowedAt: timestampSchema,
  allowedBy: z.string(),
})

export const connectionsResponseSchema = z.object({
  pending: z.array(
    z.object({
      id: idSchema,
      ip: ipSchema,
      computerName: z.string(),
      requestedAt: timestampSchema,
      lastSeenAt: timestampSchema,
    }),
  ),
  allowed: z.array(allowedComputerSchema),
})

export const allowedComputerCreateSchema = z.object({
  ip: z.ipv4(),
  computerName: z.string().trim().min(1).max(63),
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
export type AllowedComputer = z.infer<typeof allowedComputerSchema>
export type ConnectionsResponse = z.infer<typeof connectionsResponseSchema>
export type AllowedComputerCreate = z.infer<typeof allowedComputerCreateSchema>
export type SchoolProfile = z.infer<typeof schoolProfileSchema>
export type ClassesResponse = z.infer<typeof classesResponseSchema>
