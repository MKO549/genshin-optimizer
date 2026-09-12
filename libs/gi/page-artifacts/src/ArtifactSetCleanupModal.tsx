import {
  useDataEntryBase,
  useDataManagerValues,
} from '@genshin-optimizer/common/database-ui'
import { CardThemed, ModalWrapper, SqBadge } from '@genshin-optimizer/common/ui'
import type { ArtifactSetKey } from '@genshin-optimizer/gi/consts'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import {
  ArtifactCard,
  ArtifactSetAutocomplete,
  CharacterName,
} from '@genshin-optimizer/gi/ui'
import CleaningServicesIcon from '@mui/icons-material/CleaningServices'
import CloseIcon from '@mui/icons-material/Close'
import LockOpenIcon from '@mui/icons-material/LockOpen'
import LockIcon from '@mui/icons-material/Lock'
import {
  Alert,
  Box,
  Button,
  CardContent,
  CardHeader,
  Chip,
  Divider,
  Grid,
  IconButton,
  LinearProgress,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type ArtifactSetCleanupResult,
  analyzeArtifactSetCleanup,
  type CleanupSkipReason,
} from './ArtifactSetCleanup'
import {
  previewGGArtifactImport,
  type GGArtifactImportPreview,
} from './GGArtifactImport'
import {
  analyzeArtifactProfileTriage,
  type ArtifactProfileTriageResult,
} from './ArtifactProfileTriage'

export default function ArtifactSetCleanupModal({
  show,
  onHide,
}: {
  show: boolean
  onHide: () => void
}) {
  const { t } = useTranslation('artifact')
  const database = useDatabase()
  const cleanupConfig = useDataEntryBase(database.artifactCleanup)
  const artifacts = useDataManagerValues(database.arts)
  const builds = useDataManagerValues(database.builds)
  const characters = useDataManagerValues(database.chars)
  // Subscribe to linked manager updates before deriving team coverage below.
  useDataManagerValues(database.teamChars)
  useDataManagerValues(database.optConfigs)
  const [setKey, setSetKey] = useState<ArtifactSetKey | ''>('')
  const [result, setResult] = useState<ArtifactSetCleanupResult>()
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [scanning, setScanning] = useState(false)
  const [failed, setFailed] = useState(false)
  const [minProbability, setMinProbability] = useState('0')
  const [minAverageIncrease, setMinAverageIncrease] = useState('0')
  const [protectOffPieces, setProtectOffPieces] = useState(true)
  const [importPreview, setImportPreview] = useState<GGArtifactImportPreview>()
  const [profileResult, setProfileResult] =
    useState<ArtifactProfileTriageResult>()
  const runId = useRef(0)

  const defaultSet = useMemo(() => {
    const counts = new Map<ArtifactSetKey, number>()
    database.arts.values.forEach((art) => {
      if (art.rarity !== 5 || art.level >= 20 || !art.lock || art.location)
        return
      counts.set(art.setKey, (counts.get(art.setKey) ?? 0) + 1)
    })
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
  }, [database.arts.values])

  useEffect(() => {
    if (show && !setKey && defaultSet) setSetKey(defaultSet)
  }, [defaultSet, setKey, show])

  const changeSet = (key: ArtifactSetKey | '') => {
    runId.current++
    setSetKey(key)
    setResult(undefined)
    setFailed(false)
    setScanning(false)
  }

  const changeThreshold = (
    value: string,
    setValue: (value: string) => void
  ) => {
    runId.current++
    setValue(value)
    setResult(undefined)
    setFailed(false)
    setScanning(false)
  }

  const changeOffPieceProtection = (checked: boolean) => {
    runId.current++
    setProtectOffPieces(checked)
    setResult(undefined)
    setFailed(false)
    setScanning(false)
  }

  const importGGArtifact = (file?: File) => {
    if (!file || !cleanupConfig) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        setImportPreview(
          previewGGArtifactImport(
            JSON.parse(String(reader.result)),
            cleanupConfig
          )
        )
      } catch (_error) {
        setImportPreview({
          new: 0,
          updated: 0,
          unchanged: 0,
          invalid: 1,
          stale: 0,
          warnings: [t('setCleanup.ggImport.invalidJson')],
        })
      }
    }
    reader.readAsText(file)
  }

  const applyGGArtifactImport = () => {
    if (!importPreview?.config) return
    database.artifactCleanup.set(importPreview.config)
    setImportPreview(undefined)
  }

  const analyzeProfiles = () => {
    if (!cleanupConfig) return
    const referencedArtifactIds = new Set(
      builds.flatMap((build) =>
        Object.values(build.artifactIds).filter((id): id is string =>
          Boolean(id)
        )
      )
    )
    const teamTargetCharacterKeys = database.teamChars.entries.flatMap(
      ([teamCharId, teamCharacter]) => {
        const appearsInTeam = database.teams.values.some((team) =>
          team.loadoutData.some((loadout) => loadout?.teamCharId === teamCharId)
        )
        return appearsInTeam &&
          database.optConfigs.get(teamCharacter.optConfigId)?.optimizationTarget
          ? [teamCharacter.key]
          : []
      }
    )
    setProfileResult(
      analyzeArtifactProfileTriage({
        artifacts,
        config: cleanupConfig,
        referencedArtifactIds,
        ownedCharacterKeys: characters.map(({ key }) => key),
        teamTargetCharacterKeys,
      })
    )
  }

  const lockRecommended = () => {
    if (!profileResult) return
    const ids = profileResult.protected
      .filter(({ reason }) => reason !== 'safety')
      .map(({ id }) => id)
      .filter((id) => {
        const artifact = database.arts.get(id)
        return (
          artifact &&
          !artifact.lock &&
          !artifact.location &&
          artifact.rarity === 5 &&
          artifact.level < 20
        )
      })
    if (
      !ids.length ||
      !window.confirm(
        t('setCleanup.profileTriage.confirmLock', { count: ids.length })
      )
    )
      return
    ids.forEach((id) => database.arts.set(id, { lock: true }))
    setProfileResult(undefined)
  }

  const unlockProfileSafe = () => {
    if (!profileResult?.safeIds.length || profileResult.coverageMissing.length)
      return
    const ids = profileResult.safeIds.filter((id) => {
      const artifact = database.arts.get(id)
      return (
        artifact?.lock &&
        !artifact.location &&
        artifact.rarity === 5 &&
        artifact.level < 20
      )
    })
    if (
      !ids.length ||
      !window.confirm(
        t('setCleanup.profileTriage.confirmUnlock', { count: ids.length })
      )
    )
      return
    ids.forEach((id) => database.arts.set(id, { lock: false }))
    setProfileResult(undefined)
  }

  const updateProfileConfig = (
    value: Partial<NonNullable<typeof cleanupConfig>>
  ) => {
    database.artifactCleanup.set(value)
    setProfileResult(undefined)
  }

  const markCoverageNotRelevant = () => {
    if (
      !cleanupConfig?.characterCoverage ||
      !profileResult?.coverageMissing.length
    )
      return
    if (
      !window.confirm(
        t('setCleanup.profileTriage.confirmNotRelevant', {
          characters: profileResult.coverageMissing.join(', '),
        })
      )
    )
      return
    updateProfileConfig({
      characterCoverage: {
        ...cleanupConfig.characterCoverage,
        ...Object.fromEntries(
          profileResult.coverageMissing.map((character) => [
            character,
            'notRelevant',
          ])
        ),
      },
    })
  }

  const analyze = async () => {
    if (!setKey) return
    const currentRun = ++runId.current
    setScanning(true)
    setFailed(false)
    setResult(undefined)
    try {
      const next = await analyzeArtifactSetCleanup(
        database,
        setKey,
        {
          minProbability: Number(minProbability) || 0,
          minAverageIncrease: Number(minAverageIncrease) || 0,
          protectOffPieces,
        },
        (nextProgress) => {
          if (runId.current === currentRun) setProgress(nextProgress)
        }
      )
      if (runId.current === currentRun) setResult(next)
    } catch (error) {
      console.error('Artifact set cleanup analysis failed', error)
      if (runId.current === currentRun) setFailed(true)
    } finally {
      if (runId.current === currentRun) setScanning(false)
    }
  }

  const unlock = () => {
    if (!result?.safeIds.length) return
    const ids = result.safeIds.filter((id) => {
      const art = database.arts.get(id)
      return art?.lock && !art.location && art.setKey === setKey
    })
    if (
      !ids.length ||
      !window.confirm(t('setCleanup.confirmUnlock', { count: ids.length }))
    )
      return
    ids.forEach((id) => database.arts.set(id, { lock: false }))
    setResult({
      ...result,
      eligibleIds: result.eligibleIds.filter((id) => !ids.includes(id)),
      safeIds: result.safeIds.filter((id) => !ids.includes(id)),
      protectedCount: result.protectedCount + ids.length,
    })
  }

  const close = () => {
    runId.current++
    setScanning(false)
    onHide()
  }

  return (
    <ModalWrapper open={show} onClose={close}>
      <CardThemed>
        <CardHeader
          title={
            <Typography variant="h6" display="flex" alignItems="center">
              <CleaningServicesIcon sx={{ mr: 1 }} />
              {t('setCleanup.title')}
            </Typography>
          }
          action={
            <IconButton onClick={close}>
              <CloseIcon />
            </IconButton>
          }
        />
        <Divider />
        <CardContent>
          <Stack spacing={2}>
            <Alert severity="info">{t('setCleanup.description')}</Alert>
            <CardThemed bgt="light">
              <CardContent
                sx={{ py: 1.5, '&:last-child': { paddingBottom: 1.5 } }}
              >
                <Stack spacing={1}>
                  <Box
                    display="flex"
                    alignItems="center"
                    justifyContent="space-between"
                    gap={1}
                    flexWrap="wrap"
                  >
                    <Box>
                      <Typography variant="subtitle2">
                        {t('setCleanup.ggImport.title')}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t('setCleanup.ggImport.hint')}
                      </Typography>
                    </Box>
                    <Button component="label" size="small" color="info">
                      {t('setCleanup.ggImport.select')}
                      <input
                        hidden
                        type="file"
                        accept=".json,application/json"
                        onChange={(event) => {
                          importGGArtifact(event.target.files?.[0])
                          event.target.value = ''
                        }}
                      />
                    </Button>
                  </Box>
                  {cleanupConfig && (
                    <Grid container spacing={1}>
                      <Grid item xs={6} sm={3}>
                        <TextField
                          fullWidth
                          size="small"
                          type="number"
                          label={t('setCleanup.profileTriage.margin')}
                          inputProps={{ min: 0, step: 1 }}
                          value={cleanupConfig.demandMargin}
                          onChange={(event) =>
                            updateProfileConfig({
                              demandMargin: Math.max(
                                0,
                                Math.floor(Number(event.target.value) || 0)
                              ),
                            })
                          }
                        />
                      </Grid>
                      <Grid item xs={6} sm={3}>
                        <TextField
                          fullWidth
                          size="small"
                          type="number"
                          label={t('setCleanup.profileTriage.fillerCap')}
                          inputProps={{ min: 0, step: 1 }}
                          value={cleanupConfig.fillerCap}
                          onChange={(event) =>
                            updateProfileConfig({
                              fillerCap: Math.max(
                                0,
                                Math.floor(Number(event.target.value) || 0)
                              ),
                            })
                          }
                        />
                      </Grid>
                      <Grid item xs={12} sm={3}>
                        <TextField
                          fullWidth
                          select
                          size="small"
                          label={t('setCleanup.profileTriage.preset')}
                          value={cleanupConfig.keepRulePreset}
                          onChange={(event) =>
                            updateProfileConfig({
                              keepRulePreset:
                                event.target.value === 'extra'
                                  ? 'extra'
                                  : 'normal',
                            })
                          }
                        >
                          <MenuItem value="normal">
                            {t('setCleanup.profileTriage.normal')}
                          </MenuItem>
                          <MenuItem value="extra">
                            {t('setCleanup.profileTriage.extra')}
                          </MenuItem>
                        </TextField>
                      </Grid>
                      <Grid item xs={12} sm={3}>
                        <Box display="flex" alignItems="center" height="100%">
                          <Switch
                            size="small"
                            checked={
                              cleanupConfig.builtInPatterns.doubleCritFourStart
                            }
                            onChange={(_, checked) =>
                              updateProfileConfig({
                                builtInPatterns: {
                                  ...cleanupConfig.builtInPatterns,
                                  doubleCritFourStart: checked,
                                },
                              })
                            }
                          />
                          <Typography variant="caption">
                            {t('setCleanup.profileTriage.doubleCrit')}
                          </Typography>
                        </Box>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <Box display="flex" alignItems="center" height="100%">
                          <Switch
                            size="small"
                            checked={
                              cleanupConfig.builtInPatterns.erForSupportSustain
                            }
                            onChange={(_, checked) =>
                              updateProfileConfig({
                                builtInPatterns: {
                                  ...cleanupConfig.builtInPatterns,
                                  erForSupportSustain: checked,
                                },
                              })
                            }
                          />
                          <Typography variant="caption">
                            {t('setCleanup.profileTriage.erSupport')}
                          </Typography>
                        </Box>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <Box display="flex" alignItems="center" height="100%">
                          <Switch
                            size="small"
                            checked={cleanupConfig.builtInPatterns.erEverywhere}
                            onChange={(_, checked) =>
                              updateProfileConfig({
                                builtInPatterns: {
                                  ...cleanupConfig.builtInPatterns,
                                  erEverywhere: checked,
                                },
                              })
                            }
                          />
                          <Typography variant="caption">
                            {t('setCleanup.profileTriage.erEverywhere')}
                          </Typography>
                        </Box>
                      </Grid>
                    </Grid>
                  )}
                  {importPreview && (
                    <Alert
                      severity={
                        importPreview.config && !importPreview.invalid
                          ? 'success'
                          : 'warning'
                      }
                      action={
                        importPreview.config ? (
                          <Button
                            color="inherit"
                            size="small"
                            onClick={applyGGArtifactImport}
                          >
                            {t('setCleanup.ggImport.apply')}
                          </Button>
                        ) : undefined
                      }
                    >
                      {t('setCleanup.ggImport.preview', importPreview)}
                      {!!importPreview.warnings.length && (
                        <Box component="ul" sx={{ my: 0.5, pl: 2.5 }}>
                          {importPreview.warnings.slice(0, 5).map((warning) => (
                            <li key={warning}>{warning}</li>
                          ))}
                        </Box>
                      )}
                    </Alert>
                  )}
                </Stack>
              </CardContent>
            </CardThemed>
            <CardThemed bgt="light">
              <CardContent
                sx={{ py: 1.5, '&:last-child': { paddingBottom: 1.5 } }}
              >
                <Stack spacing={1}>
                  <Box
                    display="flex"
                    alignItems="center"
                    justifyContent="space-between"
                    gap={1}
                    flexWrap="wrap"
                  >
                    <Box>
                      <Typography variant="subtitle2">
                        {t('setCleanup.profileTriage.title')}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t('setCleanup.profileTriage.hint')}
                      </Typography>
                    </Box>
                    <Button
                      size="small"
                      color="info"
                      variant="contained"
                      disabled={!cleanupConfig?.profiles.length}
                      onClick={analyzeProfiles}
                    >
                      {t('setCleanup.profileTriage.analyze')}
                    </Button>
                  </Box>
                  {profileResult && (
                    <ProfileTriageResult
                      result={profileResult}
                      onLock={lockRecommended}
                      onUnlock={unlockProfileSafe}
                      onMarkNotRelevant={markCoverageNotRelevant}
                    />
                  )}
                </Stack>
              </CardContent>
            </CardThemed>
            <Box display="flex" gap={1} alignItems="center" flexWrap="wrap">
              <Box flexGrow={1} minWidth={240}>
                <ArtifactSetAutocomplete
                  artSetKey={setKey}
                  setArtSetKey={changeSet}
                />
              </Box>
              <Button
                variant="contained"
                color="info"
                startIcon={<CleaningServicesIcon />}
                disabled={!setKey || scanning}
                onClick={analyze}
              >
                {t('setCleanup.analyze')}
              </Button>
            </Box>

            <Grid container spacing={1}>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  size="small"
                  type="number"
                  label={t('setCleanup.minProbability')}
                  value={minProbability}
                  disabled={scanning}
                  inputProps={{ min: 0, max: 100, step: 0.1 }}
                  onChange={(event) =>
                    changeThreshold(event.target.value, setMinProbability)
                  }
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  size="small"
                  type="number"
                  label={t('setCleanup.minAverageIncrease')}
                  value={minAverageIncrease}
                  disabled={scanning}
                  inputProps={{ min: 0, step: 0.1 }}
                  onChange={(event) =>
                    changeThreshold(event.target.value, setMinAverageIncrease)
                  }
                />
              </Grid>
              <Grid item xs={12}>
                <Typography variant="caption" color="text.secondary">
                  {t('setCleanup.thresholdHint')}
                </Typography>
              </Grid>
            </Grid>

            <CardThemed bgt="light">
              <CardContent
                sx={{ py: 1.5, '&:last-child': { paddingBottom: 1.5 } }}
              >
                <Box
                  display="flex"
                  alignItems="center"
                  justifyContent="space-between"
                  gap={1}
                >
                  <Box>
                    <Typography variant="subtitle2">
                      {t('setCleanup.offPieceRule')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t('setCleanup.offPieceRuleHint')}
                    </Typography>
                  </Box>
                  <Box
                    display="flex"
                    alignItems="center"
                    gap={1}
                    flexShrink={0}
                  >
                    {result && protectOffPieces && (
                      <Chip
                        size="small"
                        color="info"
                        label={t('setCleanup.offPieceProtectedShort', {
                          count: result.offPieceIds.length,
                        })}
                      />
                    )}
                    <Switch
                      checked={protectOffPieces}
                      disabled={scanning}
                      inputProps={{
                        'aria-label': t('setCleanup.offPieceRule'),
                      }}
                      onChange={(_, checked) =>
                        changeOffPieceProtection(checked)
                      }
                    />
                  </Box>
                </Box>
              </CardContent>
            </CardThemed>

            {scanning && (
              <Box>
                <LinearProgress
                  variant={progress.total ? 'determinate' : 'indeterminate'}
                  value={
                    progress.total
                      ? (progress.current / progress.total) * 100
                      : undefined
                  }
                />
                <Typography variant="caption" color="text.secondary">
                  {t('setCleanup.progress', progress)}
                </Typography>
              </Box>
            )}
            {failed && <Alert severity="error">{t('setCleanup.failed')}</Alert>}
            {result && <CleanupResult result={result} onUnlock={unlock} />}
          </Stack>
        </CardContent>
      </CardThemed>
    </ModalWrapper>
  )
}

function CleanupResult({
  result,
  onUnlock,
}: {
  result: ArtifactSetCleanupResult
  onUnlock: () => void
}) {
  const { t } = useTranslation('artifact')
  const { gender } = useDBMeta()
  const skipReason = (reason: CleanupSkipReason | undefined) =>
    reason ? t(`setCleanup.skipReason.${reason}`) : ''

  return (
    <Stack spacing={2}>
      <Grid container spacing={1}>
        <ResultCount
          label={t('setCleanup.selected')}
          count={result.selectedCount}
        />
        <ResultCount
          label={t('setCleanup.eligible')}
          count={result.eligibleIds.length}
        />
        <ResultCount
          label={t('setCleanup.upgrades')}
          count={result.upgradeIds.length}
        />
        <ResultCount
          label={t('setCleanup.safe')}
          count={result.safeIds.length}
        />
      </Grid>

      {!result.analyzedLoadouts.length && (
        <Alert severity="warning">{t('setCleanup.noLoadouts')}</Alert>
      )}
      {!!result.skippedLoadouts.length && (
        <Alert severity="warning">
          <Typography>{t('setCleanup.skipped')}</Typography>
          <Box component="ul" sx={{ my: 0.5, pl: 3 }}>
            {result.skippedLoadouts.map((loadout) => (
              <li key={loadout.id}>
                {loadout.teamName} / {loadout.characterName} /{' '}
                {loadout.buildName}: {skipReason(loadout.reason)}
              </li>
            ))}
          </Box>
          <Typography variant="body2">
            {t('setCleanup.skippedSafety')}
          </Typography>
        </Alert>
      )}
      {!!result.offPieceIds.length && (
        <Alert severity="info">
          {t('setCleanup.offPieceProtected', {
            count: result.offPieceIds.length,
          })}
        </Alert>
      )}
      {!!result.analyzedLoadouts.length && !result.skippedLoadouts.length && (
        <Alert severity={result.safeIds.length ? 'success' : 'info'}>
          {t('setCleanup.summary', {
            loadouts: result.analyzedLoadouts.length,
            safe: result.safeIds.length,
            protected: result.protectedCount,
          })}
        </Alert>
      )}

      {!!result.upgradeIds.length && (
        <>
          <Typography variant="h6">{t('setCleanup.upgradeDetails')}</Typography>
          <Grid container spacing={1}>
            {result.upgradeIds.map((id) => {
              const matches = result.upgradeMatches?.[id] ?? []
              const characterKeys = [
                ...new Set(matches.map(({ characterKey }) => characterKey)),
              ]
              return (
                <Grid item key={id} xs={12} sm={6} md={4}>
                  <Stack spacing={1}>
                    <CardThemed bgt="light" sx={{ flexShrink: 0 }}>
                      <CardContent>
                        <Stack spacing={1}>
                          <Typography variant="subtitle2">
                            {t('setCleanup.upgradeFor')}
                          </Typography>
                          <Box display="flex" gap={0.5} flexWrap="wrap">
                            {characterKeys.map((characterKey) => (
                              <Chip
                                key={characterKey}
                                size="small"
                                color="info"
                                label={
                                  <CharacterName
                                    characterKey={characterKey}
                                    gender={gender}
                                  />
                                }
                              />
                            ))}
                          </Box>
                          {matches.map((match) => (
                            <Typography
                              key={match.id}
                              variant="caption"
                              color="text.secondary"
                            >
                              {match.teamName} / {match.characterName} /{' '}
                              {match.buildName}
                              {' — '}
                              {t('setCleanup.upgradeMetrics', {
                                probability: match.probability.toFixed(1),
                                average: match.averageIncrease.toFixed(1),
                              })}
                            </Typography>
                          ))}
                        </Stack>
                      </CardContent>
                    </CardThemed>
                    <ArtifactCard artifactId={id} />
                  </Stack>
                </Grid>
              )
            })}
          </Grid>
        </>
      )}

      {!!result.safeIds.length && (
        <>
          <Box display="flex" justifyContent="flex-end">
            <Button
              color="warning"
              variant="contained"
              startIcon={<LockOpenIcon />}
              onClick={onUnlock}
            >
              {t('setCleanup.unlock')}
              <SqBadge sx={{ ml: 1 }} color="secondary">
                {result.safeIds.length}
              </SqBadge>
            </Button>
          </Box>
          <Grid container spacing={1}>
            {result.safeIds.map((id) => (
              <Grid item key={id} xs={12} sm={6} md={4}>
                <ArtifactCard artifactId={id} />
              </Grid>
            ))}
          </Grid>
        </>
      )}
    </Stack>
  )
}

function ProfileTriageResult({
  result,
  onLock,
  onUnlock,
  onMarkNotRelevant,
}: {
  result: ArtifactProfileTriageResult
  onLock: () => void
  onUnlock: () => void
  onMarkNotRelevant: () => void
}) {
  const { t } = useTranslation('artifact')
  const grouped = result.protected.reduce<Record<string, number>>(
    (counts, { reason }) => {
      counts[reason] = (counts[reason] ?? 0) + 1
      return counts
    },
    {}
  )
  const lockCount = result.protected.filter(
    ({ reason }) => reason !== 'safety'
  ).length

  return (
    <Stack spacing={1}>
      {!!result.coverageMissing.length && (
        <Alert severity="warning">
          {t('setCleanup.profileTriage.coverage', {
            characters: result.coverageMissing.join(', '),
          })}
          <Box mt={1}>
            <Button color="inherit" size="small" onClick={onMarkNotRelevant}>
              {t('setCleanup.profileTriage.notRelevant')}
            </Button>
          </Box>
        </Alert>
      )}
      <Grid container spacing={1}>
        <ResultCount
          label={t('setCleanup.profileTriage.candidates')}
          count={result.candidates.length}
        />
        <ResultCount
          label={t('setCleanup.profileTriage.prime')}
          count={result.tierCounts.prime}
        />
        <ResultCount
          label={t('setCleanup.profileTriage.solid')}
          count={result.tierCounts.solid}
        />
        <ResultCount
          label={t('setCleanup.profileTriage.safe')}
          count={result.safeIds.length}
        />
      </Grid>
      <Typography variant="caption" color="text.secondary">
        {t('setCleanup.profileTriage.summary', {
          targets: result.demandTargets,
          filler: result.tierCounts.filler,
        })}
      </Typography>
      <Box display="flex" gap={0.5} flexWrap="wrap">
        {Object.entries(grouped).map(([reason, count]) => (
          <Chip
            key={reason}
            size="small"
            label={t(`setCleanup.profileTriage.reason.${reason}`, { count })}
          />
        ))}
      </Box>
      <Box display="flex" justifyContent="flex-end" gap={1} flexWrap="wrap">
        <Button
          color="info"
          variant="outlined"
          startIcon={<LockIcon />}
          disabled={!lockCount}
          onClick={onLock}
        >
          {t('setCleanup.profileTriage.lock')}
          <SqBadge sx={{ ml: 1 }} color="secondary">
            {lockCount}
          </SqBadge>
        </Button>
        <Button
          color="warning"
          variant="contained"
          startIcon={<LockOpenIcon />}
          disabled={!result.safeIds.length || !!result.coverageMissing.length}
          onClick={onUnlock}
        >
          {t('setCleanup.profileTriage.unlock')}
          <SqBadge sx={{ ml: 1 }} color="secondary">
            {result.safeIds.length}
          </SqBadge>
        </Button>
      </Box>
    </Stack>
  )
}

function ResultCount({ label, count }: { label: string; count: number }) {
  return (
    <Grid item xs={6} md={3}>
      <CardThemed bgt="light">
        <CardContent>
          <Typography variant="h5">{count}</Typography>
          <Typography variant="body2" color="text.secondary">
            {label}
          </Typography>
        </CardContent>
      </CardThemed>
    </Grid>
  )
}
