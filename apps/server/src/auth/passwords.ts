import { hash, verify } from '@node-rs/argon2'

let unusedHash: Promise<string> | undefined

// Without a stored hash we still run one verification, so a missing username takes as long as a
// wrong password and cannot be told apart by timing.
export async function checkPassword(storedHash: string | null, password: string): Promise<boolean> {
  if (storedHash === null) {
    unusedHash ??= hash('no account has this password')
    await verify(await unusedHash, password)
    return false
  }
  return verify(storedHash, password)
}
