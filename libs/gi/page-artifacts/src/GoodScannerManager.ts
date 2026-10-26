import type { ICachedArtifact } from '@genshin-optimizer/gi/db'
import type { IArtifact, ISubstat } from '@genshin-optimizer/gi/good'

export type GoodScannerArtifact = Pick<
  IArtifact,
  | 'setKey'
  | 'slotKey'
  | 'rarity'
  | 'level'
  | 'mainStatKey'
  | 'location'
  | 'lock'
  | 'elixirCrafted'
> & {
  substats: ISubstat[]
  unactivatedSubstats?: ISubstat[]
}

export type GoodScannerTarget = {
  id: string
  desiredLock: boolean
  artifact: GoodScannerArtifact
  resultId: string
}

export type GoodScannerManageRequest = {
  lock: GoodScannerArtifact[]
  unlock: GoodScannerArtifact[]
}

export type GoodScannerIssue = {
  id: string
  message: string
}

export type GoodScannerManageTargets = {
  request: GoodScannerManageRequest
  targets: GoodScannerTarget[]
  errors: GoodScannerIssue[]
  warnings: GoodScannerIssue[]
}

export type GoodScannerHealth = {
  status: 'ok'
  enabled: boolean
  busy: boolean
  gameAlive: boolean
}

export type GoodScannerJobStatus = {
  state: 'idle' | 'running' | 'completed'
  jobId?: string
  progress?: {
    completed: number
    total: number
    currentId: string
    phase: string
  }
}

export type GoodScannerResultEntry = {
  id: string
  status:
    | 'success'
    | 'already_correct'
    | 'not_found'
    | 'ocr_error'
    | 'ui_error'
    | 'aborted'
    | 'skipped'
  message?: string
}

export type GoodScannerManageResult = {
  results: GoodScannerResultEntry[]
  summary: {
    total: number
    success: number
    already_correct: number
    not_found: number
    errors: number
    aborted: number
  }
}

export type GoodScannerAcceptedJob = {
  jobId: string
  total: number
}

export class GoodScannerError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'GoodScannerError'
  }
}

function copySubstat({ key, value }: ISubstat): ISubstat {
  return { key, value }
}

/** Converts an Optimizer artifact to the identity fields GOODScanner hard-matches. */
export function toGoodScannerArtifact(
  artifact: ICachedArtifact
): GoodScannerArtifact {
  const unactivatedSubstats = artifact.unactivatedSubstats
    ?.filter(({ key }) => key)
    .map(copySubstat)
  return {
    setKey: artifact.setKey,
    slotKey: artifact.slotKey,
    rarity: artifact.rarity,
    level: artifact.level,
    mainStatKey: artifact.mainStatKey,
    substats: artifact.substats.filter(({ key }) => key).map(copySubstat),
    ...(unactivatedSubstats?.length ? { unactivatedSubstats } : {}),
    location: artifact.location,
    lock: artifact.lock,
    // GOODScanner treats this as a hard-match field and defaults a missing value
    // to false, so send it explicitly for a stable request contract.
    elixirCrafted: artifact.elixirCrafted ?? false,
  }
}

function identityKey(artifact: GoodScannerArtifact) {
  const substats = (substats: ISubstat[] | undefined) =>
    (substats ?? [])
      .map(({ key, value }) => [key, value])
      .sort(([left], [right]) => String(left).localeCompare(String(right)))
  return JSON.stringify({
    setKey: artifact.setKey,
    slotKey: artifact.slotKey,
    rarity: artifact.rarity,
    level: artifact.level,
    mainStatKey: artifact.mainStatKey,
    substats: substats(artifact.substats),
    unactivatedSubstats: substats(artifact.unactivatedSubstats),
    elixirCrafted: artifact.elixirCrafted,
  })
}

/**
 * Creates a single GOODScanner manage request from the current local lock state.
 * Identical pieces with conflicting desired lock states are excluded: GOODScanner
 * cannot distinguish those pieces, so sending them could toggle the wrong one.
 */
export function buildGoodScannerManageTargets(
  artifacts: ICachedArtifact[]
): GoodScannerManageTargets {
  const errors: GoodScannerIssue[] = []
  const warnings: GoodScannerIssue[] = []
  const candidates = artifacts.flatMap((artifact) => {
    const scannerArtifact = toGoodScannerArtifact(artifact)
    if (scannerArtifact.rarity !== 4 && scannerArtifact.rarity !== 5) {
      errors.push({
        id: artifact.id,
        message:
          'Only 4-star and 5-star artifacts can be managed by GOODScanner.',
      })
      return []
    }
    if (!scannerArtifact.substats.length) {
      errors.push({
        id: artifact.id,
        message: 'The artifact has no substats and cannot be matched safely.',
      })
      return []
    }
    return [
      {
        id: artifact.id,
        desiredLock: artifact.lock,
        artifact: scannerArtifact,
      },
    ]
  })

  const byIdentity = new Map<string, typeof candidates>()
  candidates.forEach((candidate) => {
    const key = identityKey(candidate.artifact)
    byIdentity.set(key, [...(byIdentity.get(key) ?? []), candidate])
  })
  const conflictingIds = new Set<string>()
  byIdentity.forEach((duplicates) => {
    if (duplicates.length < 2) return
    const hasLock = duplicates.some(({ desiredLock }) => desiredLock)
    const hasUnlock = duplicates.some(({ desiredLock }) => !desiredLock)
    if (hasLock && hasUnlock) {
      duplicates.forEach(({ id }) => {
        conflictingIds.add(id)
        errors.push({
          id,
          message:
            'An identical artifact has an opposing lock state. GOODScanner cannot distinguish these pieces safely.',
        })
      })
    } else
      duplicates.forEach(({ id }) =>
        warnings.push({
          id,
          message:
            'This artifact is identical to another selected piece. Both have the same requested lock state, so the batch is safe.',
        })
      )
  })

  const valid = candidates.filter(({ id }) => !conflictingIds.has(id))
  const lock = valid.filter(({ desiredLock }) => desiredLock)
  const unlock = valid.filter(({ desiredLock }) => !desiredLock)
  const targets = [
    ...lock.map((target, index) => ({ ...target, resultId: `lock:${index}` })),
    ...unlock.map((target, index) => ({
      ...target,
      resultId: `unlock:${index}`,
    })),
  ]
  return {
    request: {
      lock: lock.map(({ artifact }) => artifact),
      unlock: unlock.map(({ artifact }) => artifact),
    },
    targets,
    errors,
    warnings,
  }
}

function baseUrl(port: number) {
  return `http://127.0.0.1:${port}`
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => undefined)) as
    | { error?: unknown }
    | undefined
  if (!response.ok) {
    const message =
      typeof body?.error === 'string'
        ? body.error
        : `GOODScanner returned HTTP ${response.status}.`
    throw new GoodScannerError(message, response.status)
  }
  return body as T
}

async function request<T>(
  port: number,
  path: string,
  init?: RequestInit
): Promise<T> {
  try {
    const response = await fetch(`${baseUrl(port)}${path}`, init)
    return responseJson<T>(response)
  } catch (error) {
    if (error instanceof GoodScannerError) throw error
    throw new GoodScannerError(
      'GOODScanner could not be reached. Start its Manager HTTP server and use a local Optimizer URL.'
    )
  }
}

export function getGoodScannerHealth(port: number) {
  return request<GoodScannerHealth>(port, '/health')
}

export function startGoodScannerManage(
  port: number,
  manage: GoodScannerManageRequest
) {
  return request<GoodScannerAcceptedJob>(port, '/manage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(manage),
  })
}

export function getGoodScannerJobStatus(port: number) {
  return request<GoodScannerJobStatus>(port, '/status')
}

export function getGoodScannerManageResult(port: number, jobId: string) {
  return request<GoodScannerManageResult>(
    port,
    `/result?jobId=${encodeURIComponent(jobId)}`
  )
}
