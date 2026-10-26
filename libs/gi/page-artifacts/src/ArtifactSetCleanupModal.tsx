import {
  useDataEntryBase,
  useDataManagerValues,
} from '@genshin-optimizer/common/database-ui'
import { CardThemed, ModalWrapper } from '@genshin-optimizer/common/ui'
import {
  type ArtifactSetKey,
  type ArtifactSlotKey,
  allArtifactSetKeys,
  allArtifactSlotKeys,
  allSubstatKeys,
  artSlotMainKeys,
  charKeyToLocGenderedCharKey,
  type GenderKey,
  isCharacterKey,
  type MainStatKey,
} from '@genshin-optimizer/gi/consts'
import {
  type ArtifactCleanupConfig,
  allCleanupCharacterKeys,
  type CleanupBuildProfile,
  type CleanupCharacterKey,
  type CleanupProfileState,
  resolveCleanupProfile,
} from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import {
  ArtifactCard,
  ArtifactSetAutocomplete,
  CharacterName,
} from '@genshin-optimizer/gi/ui'
import CleaningServicesIcon from '@mui/icons-material/CleaningServices'
import CloseIcon from '@mui/icons-material/Close'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import LockIcon from '@mui/icons-material/Lock'
import LockOpenIcon from '@mui/icons-material/LockOpen'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Autocomplete,
  Box,
  Button,
  CardContent,
  CardHeader,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grid,
  IconButton,
  LinearProgress,
  MenuItem,
  Pagination,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cleanupProfileGroups } from './ArtifactCleanupGroups'
import {
  type ArtifactCleanupResult,
  analyzeArtifactCleanup,
  applyCleanupSelection,
  type CleanupArtifactResult,
  type CleanupProgress,
  type CleanupRecommendation,
  cleanupActionIds,
  cleanupLoadoutOptions,
  cleanupLoadoutSelectionOptions,
  cleanupRecommendations,
  cleanupSuggestedLoadoutIds,
} from './ArtifactSetCleanup'
import {
  type GGArtifactImportPreview,
  previewGGArtifactImport,
} from './GGArtifactImport'

const pageSize = 24
const statusColors = {
  protected: 'default',
  keep: 'success',
  level: 'info',
  review: 'warning',
  discard: 'error',
} as const

export default function ArtifactSetCleanupModal({
  show,
  onHide,
}: {
  show: boolean
  onHide: () => void
}) {
  const { t } = useTranslation([
    'artifact',
    'charNames_gen',
    'statKey_gen',
    'artifactNames_gen',
  ])
  const database = useDatabase()
  const { gender } = useDBMeta()
  const config = useDataEntryBase(database.artifactCleanup)!
  const characters = useDataManagerValues(database.chars)
  const artifacts = useDataManagerValues(database.arts)
  const [result, setResult] = useState<ArtifactCleanupResult>()
  const [progress, setProgress] = useState<CleanupProgress>({
    phase: 'profiles',
    current: 0,
    total: 0,
  })
  const [scanning, setScanning] = useState(false)
  const [notice, setNotice] = useState('')
  const [failed, setFailed] = useState(false)
  const [importPreview, setImportPreview] = useState<GGArtifactImportPreview>()
  const [editing, setEditing] = useState<CleanupProfileState>()
  const [profileCharacter, setProfileCharacter] =
    useState<CleanupCharacterKey | null>(null)
  const [setKey, setSetKey] = useState<ArtifactSetKey | ''>('')
  const [slot, setSlot] = useState<ArtifactSlotKey | ''>('')
  const [character, setCharacter] = useState<CleanupCharacterKey | null>(null)
  const [status, setStatus] = useState<CleanupRecommendation | ''>('')
  const [levelMin, setLevelMin] = useState(0)
  const [levelMax, setLevelMax] = useState(20)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string[]>([])
  const [pending, setPending] = useState<{ lock: boolean; ids: string[] }>()
  const [revision, setRevision] = useState(0)
  const [mergeProfiles, setMergeProfiles] = useState<string[]>([])
  const runId = useRef(0)
  const charLabel = useCallback(
    (key: CleanupCharacterKey) =>
      isCharacterKey(key)
        ? t(`charNames_gen:${charKeyToLocGenderedCharKey(key, gender)}`)
        : key,
    [gender, t]
  )
  const scope = useMemo(
    () =>
      [
        ...new Set([
          ...(config.characterScope === 'owned'
            ? characters.map(({ key }) => key)
            : []),
          ...database.teamChars.values.map(({ key }) => key),
          ...config.wishlist,
          ...(config.characterScope === 'allProfiles'
            ? config.profiles
                .filter(
                  (state) => !state.stale && resolveCleanupProfile(state).active
                )
                .map(({ base }) => base.characterKey)
            : []),
        ]),
      ].sort((a, b) => charLabel(a).localeCompare(charLabel(b))),
    [characters, config, charLabel, database, revision]
  )
  const update = (value: Partial<ArtifactCleanupConfig>) =>
    database.artifactCleanup.set(value)
  const loadoutOptions = useMemo(
    () => cleanupLoadoutOptions(database),
    [database, revision]
  )
  const profileGroups = useMemo(() => cleanupProfileGroups(config), [config])
  const profileCharacters = useMemo(
    () =>
      [
        ...new Set([
          ...scope,
          ...config.profiles.map(({ base }) => base.characterKey),
        ]),
      ].sort((a, b) => charLabel(a).localeCompare(charLabel(b))),
    [scope, config.profiles, charLabel]
  )

  // Subscribe synchronously: an edit invalidates the run before the next await
  // resolves, including edits made through an artifact card or another tab.
  useEffect(() => {
    const invalidate = () => {
      setRevision((value) => value + 1)
      runId.current++
      setResult(undefined)
      setSelected([])
      setPending(undefined)
      setImportPreview(undefined)
      setScanning(false)
    }
    const managers = [
      database.arts,
      database.chars,
      database.weapons,
      database.builds,
      database.buildTcs,
      database.teams,
      database.teamChars,
      database.optConfigs,
      database.charMeta,
    ]
    let previousGender = database.gender
    const unsubscribe = managers.map((manager) => manager.followAny(invalidate))
    unsubscribe.push(database.artifactCleanup.follow(invalidate))
    unsubscribe.push(
      database.dbMeta.follow(() => {
        if (database.gender !== previousGender) {
          previousGender = database.gender
          invalidate()
        }
      })
    )
    return () => {
      runId.current++
      unsubscribe.forEach((stop) => stop())
    }
  }, [database])
  useEffect(() => {
    if (!show) {
      runId.current++
      setScanning(false)
      setPending(undefined)
    }
  }, [show])
  useEffect(() => {
    setPage(1)
  }, [setKey, slot, character, status, levelMin, levelMax, result])

  const analyze = async () => {
    const currentRun = ++runId.current
    setResult(undefined)
    setSelected([])
    setNotice('')
    setFailed(false)
    setScanning(true)
    try {
      const next = await analyzeArtifactCleanup(database, config, {
        shouldCancel: () => runId.current !== currentRun,
        onProgress: (value) => {
          if (runId.current === currentRun) setProgress(value)
        },
      })
      if (runId.current === currentRun) setResult(next)
    } catch {
      if (runId.current === currentRun) setFailed(true)
    } finally {
      if (runId.current === currentRun) setScanning(false)
    }
  }
  const cancel = () => {
    runId.current++
    setScanning(false)
    setNotice(t('setCleanup.unified.cancelled'))
  }
  const readImport = async (file?: File) => {
    if (!file) return
    try {
      setImportPreview(
        previewGGArtifactImport(
          JSON.parse(await file.text()),
          database.artifactCleanup.get()
        )
      )
    } catch {
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
  const filtered = useMemo(
    () =>
      (result?.artifacts ?? [])
        .filter(
          (row) =>
            (!setKey || row.setKey === setKey) &&
            (!slot || row.slotKey === slot) &&
            (!character || row.characterKeys.includes(character)) &&
            (!status || row.recommendation === status) &&
            row.level >= levelMin &&
            row.level <= levelMax
        )
        .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id)),
    [result, setKey, slot, character, status, levelMin, levelMax]
  )
  const actionable = (row: CleanupArtifactResult) => {
    const art = database.arts.get(row.id)
    return Boolean(
      art &&
        ((row.recommendation === 'discard' && art.lock) ||
          ((row.recommendation === 'keep' || row.recommendation === 'level') &&
            !art.lock))
    )
  }
  const toggle = (id: string) =>
    setSelected((old) =>
      old.includes(id) ? old.filter((value) => value !== id) : [...old, id]
    )
  const preview = (lock: boolean) => {
    if (!result) return
    const ids = cleanupActionIds(database, result, selected, lock)
    if (ids.length) setPending({ lock, ids })
    else setNotice(t('setCleanup.unified.noAction'))
  }
  const apply = () => {
    if (!result || !pending) return
    const next = applyCleanupSelection(
      database,
      result,
      pending.ids,
      pending.lock
    )
    setPending(undefined)
    setNotice(
      t(
        next.stale ? 'setCleanup.unified.stale' : 'setCleanup.unified.applied',
        { count: next.appliedIds.length }
      )
    )
  }
  const saveProfile = (draft: CleanupBuildProfile) => {
    if (!editing) return
    const profiles = database.artifactCleanup.get().profiles
    const exists = profiles.some(({ base }) => base.id === editing.base.id)
    const original = resolveCleanupProfile(editing)
    const changes = Object.fromEntries(
      Object.entries(draft).filter(
        ([key, value]) =>
          JSON.stringify(value) !==
          JSON.stringify(original[key as keyof CleanupBuildProfile])
      )
    ) as Partial<CleanupBuildProfile>
    update({
      goProfileCoverage: Object.fromEntries(
        Object.entries(database.artifactCleanup.get().goProfileCoverage).filter(
          ([id]) => id !== draft.id || !Object.keys(changes).length
        )
      ),
      profiles: exists
        ? profiles.map((state) =>
            state.base.id === editing.base.id
              ? { ...state, overrides: { ...state.overrides, ...changes } }
              : state
          )
        : [...profiles, { base: draft }],
    })
    setEditing(undefined)
  }

  return (
    <>
      <ModalWrapper
        open={show}
        onClose={onHide}
        containerProps={{
          maxWidth: false,
          sx: { maxWidth: 1400, p: { xs: 1, sm: 2 } },
        }}
      >
        <CardThemed>
          <CardHeader
            title={
              <Box display="flex" alignItems="center" gap={1}>
                <CleaningServicesIcon />
                {t('setCleanup.title')}
              </Box>
            }
            action={
              <IconButton
                aria-label={t('setCleanup.unified.close')}
                onClick={onHide}
              >
                <CloseIcon />
              </IconButton>
            }
          />
          <CardContent>
            <Stack spacing={2}>
              <Alert severity="info">
                {t('setCleanup.unified.description')}
              </Alert>
              <Typography variant="h6">
                {t('setCleanup.unified.chooseSets')}
              </Typography>
              <Autocomplete
                multiple
                options={[
                  ...new Set(artifacts.map(({ setKey }) => setKey)),
                ].sort((a, b) =>
                  t(`artifactNames_gen:${a}`).localeCompare(
                    t(`artifactNames_gen:${b}`)
                  )
                )}
                value={config.selectedSetKeys}
                getOptionLabel={(key) => t(`artifactNames_gen:${key}`)}
                onChange={(_, selectedSetKeys) => update({ selectedSetKeys })}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label={t('setCleanup.unified.selectedSets')}
                  />
                )}
              />
              <Typography variant="body2">
                {t('setCleanup.unified.setCount', {
                  count: artifacts.filter(({ setKey }) =>
                    config.selectedSetKeys.includes(setKey)
                  ).length,
                })}
              </Typography>
              <CleanupLoadoutSelection
                config={config}
                revision={revision}
                charLabel={charLabel}
              />
              <Accordion disableGutters>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography>{t('setCleanup.unified.settings')}</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Stack spacing={2}>
                    <Typography variant="body2">
                      {t('setCleanup.unified.coverageHint')}
                    </Typography>
                    <TextField
                      select
                      size="small"
                      label={t('setCleanup.unified.characterScope')}
                      value={config.characterScope}
                      onChange={(event) =>
                        update({
                          characterScope: event.target
                            .value as ArtifactCleanupConfig['characterScope'],
                        })
                      }
                    >
                      <MenuItem value="allProfiles">
                        {t('setCleanup.unified.allProfiles')}
                      </MenuItem>
                      <MenuItem value="owned">
                        {t('setCleanup.unified.ownedProfiles')}
                      </MenuItem>
                    </TextField>
                    <Autocomplete
                      multiple
                      options={[...allCleanupCharacterKeys]}
                      value={config.wishlist}
                      getOptionLabel={charLabel}
                      onChange={(_, wishlist) => update({ wishlist })}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label={t('setCleanup.unified.wishlist')}
                        />
                      )}
                    />
                    <Autocomplete
                      multiple
                      options={scope}
                      value={scope.filter(
                        (key) => config.characterCoverage[key] === 'notRelevant'
                      )}
                      getOptionLabel={charLabel}
                      onChange={(_, excluded) => {
                        const characterCoverage = {
                          ...config.characterCoverage,
                        }
                        scope.forEach((key) => {
                          delete characterCoverage[key]
                        })
                        excluded.forEach((key) => {
                          characterCoverage[key] = 'notRelevant'
                        })
                        update({ characterCoverage })
                      }}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label={t('setCleanup.unified.excluded')}
                        />
                      )}
                    />
                    <Typography variant="body2">
                      {t('setCleanup.unified.scope', {
                        count: scope.filter(
                          (key) => !config.characterCoverage[key]
                        ).length,
                      })}
                    </Typography>
                    <TextField
                      type="number"
                      size="small"
                      label={t('setCleanup.unified.reserveCount')}
                      value={config.demandMargin}
                      inputProps={{ min: 0, step: 1 }}
                      onChange={(event) =>
                        update({ demandMargin: Number(event.target.value) })
                      }
                    />
                    <Typography variant="caption">
                      {t('setCleanup.unified.thresholdHint')}
                    </Typography>
                    <Grid container spacing={1}>
                      {(
                        [
                          ['topN', config.topN, 1],
                          ['maxLoadoutSeconds', config.maxLoadoutSeconds, 1],
                          [
                            'minProbability',
                            config.upgradeThresholds.minProbability,
                            0.1,
                          ],
                          [
                            'minAverageIncrease',
                            config.upgradeThresholds.minAverageIncrease,
                            0.1,
                          ],
                        ] as const
                      ).map(([key, value, step]) => (
                        <Grid item xs={6} sm={3} key={key}>
                          <TextField
                            fullWidth
                            type="number"
                            size="small"
                            label={t(`setCleanup.unified.${key}`)}
                            value={value}
                            inputProps={{ min: 0, step }}
                            onChange={(event) => {
                              const next = Number(event.target.value)
                              if (key === 'topN' || key === 'maxLoadoutSeconds')
                                update({ [key]: next })
                              else
                                update({
                                  upgradeThresholds: {
                                    ...config.upgradeThresholds,
                                    [key]: next,
                                  },
                                })
                            }}
                          />
                        </Grid>
                      ))}
                    </Grid>
                    <Box display="flex" flexWrap="wrap">
                      {(
                        [
                          'doubleCritFourStart',
                          'erForSupportSustain',
                          'erEverywhere',
                        ] as const
                      ).map((key) => (
                        <FormControlLabel
                          key={key}
                          label={t(`setCleanup.unified.preference.${key}`)}
                          control={
                            <Switch
                              checked={config.builtInPatterns[key]}
                              onChange={(_, checked) =>
                                update({
                                  builtInPatterns: {
                                    ...config.builtInPatterns,
                                    [key]: checked,
                                  },
                                })
                              }
                            />
                          }
                        />
                      ))}
                    </Box>
                    <TextField
                      select
                      size="small"
                      label={t('setCleanup.profileTriage.preset')}
                      value={config.keepRulePreset}
                      onChange={(e) =>
                        update({
                          keepRulePreset: e.target.value as 'normal' | 'extra',
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
                    <Typography variant="caption">
                      {t('setCleanup.unified.floorsHint')}
                    </Typography>
                    <Grid container spacing={1}>
                      {allArtifactSlotKeys.map((key) => {
                        const field =
                          config.keepRulePreset === 'extra'
                            ? 'extraFloors'
                            : 'floors'
                        return (
                          <Grid item xs={6} sm={2} key={key}>
                            <TextField
                              fullWidth
                              type="number"
                              size="small"
                              label={t(`slotName.${key}`)}
                              value={config[field][key]}
                              inputProps={{ min: 0 }}
                              onChange={(e) =>
                                update({
                                  [field]: {
                                    ...config[field],
                                    [key]: Number(e.target.value),
                                  },
                                })
                              }
                            />
                          </Grid>
                        )
                      })}
                    </Grid>
                    <Button component="label" variant="outlined">
                      {t('setCleanup.ggImport.select')}
                      <input
                        hidden
                        type="file"
                        accept="application/json,.json"
                        onChange={(e) => {
                          void readImport(e.target.files?.[0])
                          e.target.value = ''
                        }}
                      />
                    </Button>
                    {importPreview && (
                      <Alert
                        severity={
                          importPreview.invalid || importPreview.warnings.length
                            ? 'warning'
                            : 'info'
                        }
                      >
                        <Typography>
                          {t('setCleanup.ggImport.preview', importPreview)}
                        </Typography>
                        {[...new Set(importPreview.warnings)].map((warning) => (
                          <Typography
                            variant="caption"
                            display="block"
                            key={warning}
                          >
                            {warning}
                          </Typography>
                        ))}
                        <Button
                          disabled={!importPreview.config}
                          onClick={() => {
                            if (importPreview.config)
                              database.artifactCleanup.set(importPreview.config)
                          }}
                        >
                          {t('setCleanup.ggImport.apply')}
                        </Button>
                      </Alert>
                    )}
                    <Autocomplete
                      options={profileCharacters}
                      value={profileCharacter}
                      getOptionLabel={charLabel}
                      onChange={(_, value) => setProfileCharacter(value)}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label={t('setCleanup.unified.profileCharacter')}
                        />
                      )}
                    />
                    {config.profiles
                      .filter(
                        (state) => state.base.characterKey === profileCharacter
                      )
                      .map((state) => {
                        const profile = resolveCleanupProfile(state)
                        const suggested = cleanupSuggestedLoadoutIds(
                          database,
                          profile
                        )
                        const options = loadoutOptions
                          .filter(
                            (loadout) =>
                              loadout.characterKey === profile.characterKey
                          )
                          .sort(
                            (a, b) =>
                              Number(suggested.has(b.id)) -
                              Number(suggested.has(a.id))
                          )
                        return (
                          <Box
                            key={profile.id}
                            display="flex"
                            flexDirection="column"
                            gap={1}
                          >
                            <FormControlLabel
                              control={
                                <Checkbox
                                  checked={profile.active && !state.stale}
                                  disabled={state.stale}
                                  onChange={(_, active) =>
                                    update({
                                      profiles: config.profiles.map((item) =>
                                        item.base.id === profile.id
                                          ? {
                                              ...item,
                                              overrides: {
                                                ...item.overrides,
                                                active,
                                              },
                                            }
                                          : item
                                      ),
                                    })
                                  }
                                />
                              }
                              label={`${profile.name || t('setCleanup.unified.unnamedProfile')} (${profile.roles.join(', ')})${state.stale ? ` — ${t('setCleanup.unified.staleProfile')}` : ''}`}
                            />
                            <Typography variant="caption">
                              {t('setCleanup.unified.playstyle', {
                                name:
                                  profileGroups
                                    .find((group) =>
                                      group.profiles.some(
                                        ({ id }) => id === profile.id
                                      )
                                    )
                                    ?.profiles.map(({ name }) => name)
                                    .join(' / ') ?? profile.name,
                              })}
                            </Typography>
                            <Autocomplete
                              multiple
                              options={options.map(({ id }) => id)}
                              value={config.goProfileCoverage[profile.id] ?? []}
                              getOptionLabel={(id) => {
                                const loadout = options.find(
                                  (item) => item.id === id
                                )
                                return loadout
                                  ? [
                                      loadout.teamName,
                                      loadout.buildName,
                                      suggested.has(id)
                                        ? t('setCleanup.unified.suggested')
                                        : '',
                                      loadout.reason
                                        ? t(
                                            'setCleanup.skipReason.' +
                                              loadout.reason
                                          )
                                        : '',
                                    ]
                                      .filter(Boolean)
                                      .join(' / ')
                                  : id
                              }}
                              onChange={(_, ids) =>
                                update({
                                  goProfileCoverage: {
                                    ...config.goProfileCoverage,
                                    [profile.id]: ids,
                                  },
                                })
                              }
                              renderInput={(params) => (
                                <TextField
                                  {...params}
                                  label={t(
                                    'setCleanup.unified.confirmCoverage'
                                  )}
                                  helperText={t(
                                    'setCleanup.unified.confirmCoverageHint'
                                  )}
                                />
                              )}
                            />
                            <Box display="flex" gap={1}>
                              <Button
                                onClick={() =>
                                  update({
                                    profileGroups: {
                                      ...config.profileGroups,
                                      [profile.id]: `profile:${profile.id}`,
                                    },
                                  })
                                }
                              >
                                {t('setCleanup.unified.splitGroup')}
                              </Button>
                              <Button onClick={() => setEditing(state)}>
                                {t('setCleanup.unified.edit')}
                              </Button>
                            </Box>
                          </Box>
                        )
                      })}
                    {!!profileCharacter && (
                      <Box>
                        <Autocomplete
                          multiple
                          options={config.profiles
                            .filter(
                              ({ base, stale }) =>
                                base.characterKey === profileCharacter && !stale
                            )
                            .map(({ base }) => base.id)}
                          value={mergeProfiles.filter((id) =>
                            config.profiles.some(
                              ({ base }) =>
                                base.id === id &&
                                base.characterKey === profileCharacter
                            )
                          )}
                          getOptionLabel={(id) => {
                            const state = config.profiles.find(
                              ({ base }) => base.id === id
                            )
                            return state
                              ? resolveCleanupProfile(state).name
                              : id
                          }}
                          onChange={(_, ids) => setMergeProfiles(ids)}
                          renderInput={(params) => (
                            <TextField
                              {...params}
                              label={t('setCleanup.unified.mergeProfiles')}
                            />
                          )}
                        />
                        <Button
                          disabled={
                            mergeProfiles.filter((id) =>
                              config.profiles.some(
                                ({ base }) =>
                                  base.id === id &&
                                  base.characterKey === profileCharacter
                              )
                            ).length < 2
                          }
                          onClick={() => {
                            const group = `manual:${crypto.randomUUID()}`
                            const ids = mergeProfiles.filter((id) =>
                              config.profiles.some(
                                ({ base }) =>
                                  base.id === id &&
                                  base.characterKey === profileCharacter
                              )
                            )
                            update({
                              profileGroups: {
                                ...config.profileGroups,
                                ...Object.fromEntries(
                                  ids.map((id) => [id, group])
                                ),
                              },
                            })
                            setMergeProfiles([])
                          }}
                        >
                          {t('setCleanup.unified.mergeGroups')}
                        </Button>
                      </Box>
                    )}
                    <Button
                      disabled={!profileCharacter}
                      onClick={() => {
                        if (profileCharacter)
                          setEditing({
                            base: {
                              id: `cleanup-${crypto.randomUUID()}`,
                              characterKey: profileCharacter,
                              name: charLabel(profileCharacter),
                              active: true,
                              roles: ['dps'],
                              styles: [],
                              setTargets: {
                                fourPieceSets: [],
                                halfSets: [],
                                halfSetFamilies: [],
                              },
                              mainStatWeights: {
                                sands: { atk_: 100 },
                                goblet: { atk_: 100 },
                                circlet: { critRate_: 100 },
                              },
                              substatWeights: { critRate_: 100, critDMG_: 100 },
                              substatWeightThreshold: 60,
                              mustPresentWeightThreshold: 90,
                            },
                          })
                      }}
                    >
                      {t('setCleanup.unified.addProfile')}
                    </Button>
                    {!!config.patterns.length && (
                      <Typography variant="body2">
                        {t('setCleanup.unified.patterns', {
                          names: config.patterns
                            .filter(({ enabled }) => enabled)
                            .map(({ name }) => name)
                            .join(', '),
                        })}
                      </Typography>
                    )}
                  </Stack>
                </AccordionDetails>
              </Accordion>
              <Box display="flex" gap={1} alignItems="center">
                <Button
                  variant="contained"
                  onClick={() => void analyze()}
                  disabled={
                    scanning ||
                    !config.selectedSetKeys.length ||
                    !artifacts.some(({ setKey }) =>
                      config.selectedSetKeys.includes(setKey)
                    )
                  }
                >
                  {t('setCleanup.unified.analyze')}
                </Button>
                {scanning && (
                  <Button onClick={cancel}>
                    {t('setCleanup.unified.cancel')}
                  </Button>
                )}
              </Box>
              {scanning && (
                <Box>
                  <LinearProgress
                    variant={
                      progress.total && !progress.loadout
                        ? 'determinate'
                        : 'indeterminate'
                    }
                    value={
                      progress.total
                        ? (progress.current / progress.total) * 100
                        : undefined
                    }
                  />
                  <Typography variant="caption">
                    {t(
                      `setCleanup.unified.progress.${progress.phase}`,
                      progress
                    )}
                  </Typography>
                  {progress.loadout && (
                    <Typography variant="body2">
                      {progress.loadout.teamName} / {progress.loadout.buildName}
                      {progress.candidateTotal !== undefined &&
                        ' · ' +
                          (progress.candidateCurrent ?? 0) +
                          ' / ' +
                          progress.candidateTotal}
                    </Typography>
                  )}
                  {progress.searchStage && (
                    <Typography variant="caption" display="block" role="status">
                      {t(
                        `setCleanup.unified.progress.${progress.searchStage}`,
                        {
                          count: progress.searchTested ?? 0,
                          seconds: Math.floor(
                            (progress.searchElapsedMs ?? 0) / 1000
                          ),
                        }
                      )}
                    </Typography>
                  )}
                </Box>
              )}
              {notice && <Alert severity="info">{notice}</Alert>}
              {failed && (
                <Alert severity="error">{t('setCleanup.failed')}</Alert>
              )}
              {result && (
                <>
                  <Typography variant="h6">
                    {t('setCleanup.unified.reviewResults')}
                  </Typography>
                  {!!result.incompleteGroups.length && (
                    <Accordion
                      disableGutters
                      TransitionProps={{ unmountOnExit: true }}
                    >
                      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <Typography>
                          {t('setCleanup.unified.incompleteGroupsCount', {
                            count: result.incompleteGroups.length,
                          })}
                        </Typography>
                      </AccordionSummary>
                      <AccordionDetails>
                        <Stack spacing={1}>
                          {result.incompleteGroups.map((group) => (
                            <Typography key={group.id} variant="body2">
                              {charLabel(group.characterKey)} /{' '}
                              {group.profileName}:{' '}
                              {group.missingSlots
                                .map((slot) => t(`slotName.${slot}`))
                                .join(', ')}
                            </Typography>
                          ))}
                        </Stack>
                      </AccordionDetails>
                    </Accordion>
                  )}
                  <Typography variant="body2">
                    {t('setCleanup.unified.coverageSummary', {
                      count: result.profileCoverage.filter(
                        ({ covered }) => covered
                      ).length,
                      total: result.profileCoverage.length,
                    })}
                  </Typography>
                  {!!result.coverageMissing.length && (
                    <Alert severity="warning">
                      {t('setCleanup.unified.coverage', {
                        characters: result.coverageMissing
                          .map(charLabel)
                          .join(', '),
                      })}
                    </Alert>
                  )}
                  {!!result.skippedLoadouts.length && (
                    <Alert severity="warning">
                      <Typography>
                        {t('setCleanup.skippedSummary', {
                          count: result.skippedLoadouts.length,
                        })}
                      </Typography>
                      {[
                        ...new Set(
                          result.skippedLoadouts.map(({ reason }) => reason)
                        ),
                      ].map((reason) => (
                        <Typography variant="body2" key={reason}>
                          {
                            result.skippedLoadouts.filter(
                              (loadout) => loadout.reason === reason
                            ).length
                          }
                          {' × '}
                          {t(`setCleanup.skipReason.${reason}`)}
                        </Typography>
                      ))}
                      <Accordion
                        disableGutters
                        elevation={0}
                        sx={{ bgcolor: 'transparent' }}
                      >
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                          {t('setCleanup.skippedDetails')}
                        </AccordionSummary>
                        <AccordionDetails
                          sx={{ maxHeight: 320, overflow: 'auto' }}
                        >
                          {result.skippedLoadouts.map((loadout) => (
                            <Typography variant="body2" key={loadout.id}>
                              {loadout.teamName} /{' '}
                              {charLabel(loadout.characterKey)} /{' '}
                              {loadout.buildName}:{' '}
                              {t(`setCleanup.skipReason.${loadout.reason}`)}
                            </Typography>
                          ))}
                        </AccordionDetails>
                      </Accordion>
                    </Alert>
                  )}
                  {!!result.profileWarnings.length && (
                    <Alert severity="warning">
                      {t('setCleanup.unified.profileWarnings', {
                        names: result.profileWarnings.join(', '),
                      })}
                    </Alert>
                  )}
                  <Box display="flex" gap={1} flexWrap="wrap">
                    {cleanupRecommendations.map((key) => (
                      <Chip
                        key={key}
                        color={statusColors[key]}
                        variant={status === key ? 'filled' : 'outlined'}
                        label={`${t(`setCleanup.unified.status.${key}`)}: ${result.counts[key]}`}
                        onClick={() =>
                          setStatus((old) => (old === key ? '' : key))
                        }
                      />
                    ))}
                  </Box>
                  <Grid container spacing={1}>
                    <Grid item xs={12} sm={4}>
                      <ArtifactSetAutocomplete
                        artSetKey={setKey}
                        setArtSetKey={setSetKey}
                      />
                    </Grid>
                    <Grid item xs={6} sm={2}>
                      <TextField
                        fullWidth
                        select
                        size="small"
                        label={t('slot')}
                        value={slot}
                        onChange={(e) =>
                          setSlot(e.target.value as ArtifactSlotKey | '')
                        }
                      >
                        <MenuItem value="">
                          {t('setCleanup.unified.all')}
                        </MenuItem>
                        {allArtifactSlotKeys.map((key) => (
                          <MenuItem key={key} value={key}>
                            {t(`slotName.${key}`)}
                          </MenuItem>
                        ))}
                      </TextField>
                    </Grid>
                    <Grid item xs={12} sm={3}>
                      <Autocomplete
                        size="small"
                        options={scope}
                        value={character}
                        getOptionLabel={charLabel}
                        onChange={(_, value) => setCharacter(value)}
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            label={t('setCleanup.unified.character')}
                          />
                        )}
                      />
                    </Grid>
                    <Grid item xs={6} sm={1.5}>
                      <TextField
                        fullWidth
                        size="small"
                        type="number"
                        label={t('setCleanup.unified.minLevel')}
                        value={levelMin}
                        inputProps={{ min: 0, max: 20 }}
                        onChange={(e) =>
                          setLevelMin(
                            Math.min(20, Math.max(0, Number(e.target.value)))
                          )
                        }
                      />
                    </Grid>
                    <Grid item xs={6} sm={1.5}>
                      <TextField
                        fullWidth
                        size="small"
                        type="number"
                        label={t('setCleanup.unified.maxLevel')}
                        value={levelMax}
                        inputProps={{ min: 0, max: 20 }}
                        onChange={(e) =>
                          setLevelMax(
                            Math.min(20, Math.max(0, Number(e.target.value)))
                          )
                        }
                      />
                    </Grid>
                  </Grid>
                  <Box
                    display="flex"
                    gap={1}
                    alignItems="center"
                    flexWrap="wrap"
                  >
                    <Typography>
                      {t('setCleanup.unified.selection', {
                        shown: filtered.length,
                        selected: selected.length,
                      })}
                    </Typography>
                    <Button
                      onClick={() =>
                        setSelected((old) => [
                          ...new Set([
                            ...old,
                            ...filtered.filter(actionable).map(({ id }) => id),
                          ]),
                        ])
                      }
                    >
                      {t('setCleanup.unified.selectFiltered')}
                    </Button>
                    <Button onClick={() => setSelected([])}>
                      {t('setCleanup.unified.clearSelection')}
                    </Button>
                    <Button
                      startIcon={<LockIcon />}
                      disabled={!selected.length}
                      onClick={() => preview(true)}
                    >
                      {t('setCleanup.unified.lock')}
                    </Button>
                    <Button
                      color="warning"
                      startIcon={<LockOpenIcon />}
                      disabled={!selected.length}
                      onClick={() => preview(false)}
                    >
                      {t('setCleanup.unified.unlock')}
                    </Button>
                  </Box>
                  <Grid container spacing={2}>
                    {filtered
                      .slice((page - 1) * pageSize, page * pageSize)
                      .map((row) => (
                        <Grid item xs={12} sm={6} md={4} key={row.id}>
                          <Stack spacing={1}>
                            <CardThemed bgt="light">
                              <CardContent>
                                <Box display="flex" alignItems="center">
                                  <Checkbox
                                    checked={selected.includes(row.id)}
                                    disabled={!actionable(row)}
                                    onChange={() => toggle(row.id)}
                                    inputProps={{
                                      'aria-label': t(
                                        'setCleanup.unified.selectArtifact',
                                        { id: row.id }
                                      ),
                                    }}
                                  />
                                  <Chip
                                    color={statusColors[row.recommendation]}
                                    label={t(
                                      `setCleanup.unified.status.${row.recommendation}`
                                    )}
                                  />
                                </Box>
                                <Typography variant="body2">
                                  {row.reasons
                                    .map((reason) =>
                                      t(`setCleanup.unified.reason.${reason}`)
                                    )
                                    .join(' · ')}
                                </Typography>
                                <ArtifactEvidence row={row} />
                              </CardContent>
                            </CardThemed>
                            <ArtifactCard artifactId={row.id} />
                          </Stack>
                        </Grid>
                      ))}
                  </Grid>
                  {!filtered.length && (
                    <Typography>{t('setCleanup.unified.empty')}</Typography>
                  )}
                  {filtered.length > pageSize && (
                    <Pagination
                      count={Math.ceil(filtered.length / pageSize)}
                      page={page}
                      onChange={(_, value) => setPage(value)}
                    />
                  )}
                </>
              )}
            </Stack>
          </CardContent>
        </CardThemed>
      </ModalWrapper>
      <Dialog
        open={Boolean(pending)}
        onClose={() => setPending(undefined)}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>
          {t(
            pending?.lock
              ? 'setCleanup.unified.confirmLock'
              : 'setCleanup.unified.confirmUnlock',
            { count: pending?.ids.length ?? 0 }
          )}
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 1 }}>
            {t('setCleanup.unified.actionHint')}
          </Typography>
          <Stack spacing={1}>
            {pending?.ids.map((id) => {
              const row = result?.artifacts.find((row) => row.id === id)
              return (
                row && (
                  <Typography key={id}>
                    {t(`artifactNames_gen:${row.setKey}`)} /{' '}
                    {t(`slotName.${row.slotKey}`)} / +{row.level} / {id}
                  </Typography>
                )
              )
            })}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPending(undefined)}>
            {t('setCleanup.unified.cancel')}
          </Button>
          <Button
            color={pending?.lock ? 'primary' : 'warning'}
            variant="contained"
            onClick={apply}
          >
            {t('setCleanup.unified.apply')}
          </Button>
        </DialogActions>
      </Dialog>
      {editing && (
        <CleanupProfileEditor
          state={editing}
          onClose={() => setEditing(undefined)}
          onSave={saveProfile}
        />
      )}
    </>
  )
}

function ArtifactEvidence({ row }: { row: CleanupArtifactResult }) {
  const database = useDatabase()
  const { t } = useTranslation('artifact')
  const { gender } = useDBMeta()
  const upgrades = row.goEvidence
    .filter(({ upgrade }) => upgrade)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
  return (
    <Stack spacing={0.5} sx={{ mt: 1 }}>
      {!database.arts.get(row.id)?.lock && (
        <Typography variant="caption">
          {t('setCleanup.unified.alreadyUnlocked')}
        </Typography>
      )}
      {row.reservedFor.map((assignment) => (
        <Typography variant="caption" key={assignment.profileId}>
          {t(`setCleanup.unified.reason.${assignment.reason}`)}:{' '}
          <CleanupCharacterName
            gender={gender}
            characterKey={assignment.characterKey}
          />
        </Typography>
      ))}
      {upgrades.slice(0, 2).map((evidence) => (
        <Typography key={evidence.loadout.id} variant="caption">
          <CleanupCharacterName
            gender={gender}
            characterKey={evidence.loadout.characterKey}
          />{' '}
          — {evidence.loadout.teamName} / {evidence.loadout.buildName}:{' '}
          {t('setCleanup.unified.buildMetrics', {
            baseline: evidence.baseline?.toFixed(2),
            value: evidence.bestValue?.toFixed(2) ?? '?',
            increase: evidence.averageIncrease?.toFixed(2) ?? '?',
          })}{' '}
          ({t(`setCleanup.unified.accuracy.${evidence.accuracy}`)})
        </Typography>
      ))}
      {!!row.profileMatches.length && (
        <Typography variant="caption">
          {t('setCleanup.unified.profileEstimate')}:{' '}
          <CleanupCharacterName
            gender={gender}
            characterKey={row.profileMatches[0].characterKey}
          />{' '}
          ({row.profileMatches[0].score.toFixed(2)})
        </Typography>
      )}
      {!!row.issues.length && (
        <Typography variant="caption" color="warning.main">
          {t('setCleanup.unified.reviewHint')}
        </Typography>
      )}
      <Accordion
        disableGutters
        elevation={0}
        TransitionProps={{ unmountOnExit: true }}
        sx={{ bgcolor: 'transparent' }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="caption">
            {t('setCleanup.unified.details')}
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Stack spacing={0.5}>
            {row.profileMatches.map((match) => (
              <Typography key={match.profileId} variant="caption">
                <CleanupCharacterName
                  gender={gender}
                  characterKey={match.characterKey}
                />{' '}
                / {match.name || t('setCleanup.unified.unnamedProfile')}:{' '}
                {match.score.toFixed(2)} (
                {t('setCleanup.unified.profileEstimate')})
              </Typography>
            ))}
            {row.goEvidence.map((evidence) => (
              <Box key={evidence.loadout.id}>
                <Typography variant="caption">
                  <CleanupCharacterName
                    gender={gender}
                    characterKey={evidence.loadout.characterKey}
                  />{' '}
                  / {evidence.loadout.teamName} / {evidence.loadout.buildName}:{' '}
                  {t(`setCleanup.unified.evidence.${evidence.status}`)}
                  {evidence.baseline !== undefined && (
                    <>
                      {' '}
                      —{' '}
                      {t('setCleanup.unified.buildMetrics', {
                        baseline: evidence.baseline?.toFixed(2),
                        value: evidence.bestValue?.toFixed(2) ?? '?',
                        increase: evidence.averageIncrease?.toFixed(2) ?? '?',
                      })}{' '}
                      ({t(`setCleanup.unified.accuracy.${evidence.accuracy}`)})
                    </>
                  )}
                </Typography>
                {evidence.status === 'topBuild' && (
                  <Typography variant="caption" display="block">
                    {t('setCleanup.unified.topRank', {
                      rank: evidence.rank,
                      value: evidence.topValue?.toFixed(2) ?? '?',
                    })}
                  </Typography>
                )}
                {evidence.probability !== undefined && (
                  <Typography variant="caption" display="block">
                    {t('setCleanup.unified.upgradeChance', {
                      probability: (evidence.probability * 100).toFixed(1),
                      value: evidence.topValue?.toFixed(2) ?? '?',
                    })}
                  </Typography>
                )}
                {!!evidence.artifactIds?.length && (
                  <Box display="flex" flexWrap="wrap" gap={1}>
                    {evidence.artifactIds.map((id) => (
                      <Box key={id} sx={{ maxWidth: 300 }}>
                        <ArtifactCard artifactId={id} />
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>
            ))}
            {[...new Set(row.issues)].map((issue) => (
              <Typography variant="caption" key={issue}>
                {t(`setCleanup.unified.issue.${issue}`, {
                  defaultValue: issue,
                })}
              </Typography>
            ))}
          </Stack>
        </AccordionDetails>
      </Accordion>
    </Stack>
  )
}

/** Builds to analyze. Without an explicit choice, the suggestion follows the sets. */
function CleanupLoadoutSelection({
  config,
  revision,
  charLabel,
}: {
  config: ArtifactCleanupConfig
  revision: number
  charLabel: (key: CleanupCharacterKey) => string
}) {
  const { t } = useTranslation('artifact')
  const database = useDatabase()
  const options = useMemo(
    () => cleanupLoadoutSelectionOptions(database, config.selectedSetKeys),
    // `revision` follows every database change that alters the build list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [database, config.selectedSetKeys, revision]
  )
  const suggested = options.filter(({ suggested }) => suggested)
  const selected = new Set(
    config.selectedLoadoutIds ?? suggested.map(({ id }) => id)
  )
  const checkable = options.filter(({ reason }) => !reason)
  const teams = [...new Set(options.map(({ teamName }) => teamName))]
  const select = (ids: string[] | undefined) =>
    database.artifactCleanup.set({ selectedLoadoutIds: ids })
  const toggle = (id: string, checked: boolean) =>
    select(
      checked
        ? [...selected, id]
        : [...selected].filter((value) => value !== id)
    )
  return (
    <Accordion disableGutters TransitionProps={{ unmountOnExit: true }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography>
          {t('setCleanup.unified.loadoutSelection', {
            count: checkable.filter(({ id }) => selected.has(id)).length,
            total: checkable.length,
          })}
        </Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={1}>
          <Typography variant="caption">
            {t(
              config.selectedLoadoutIds
                ? 'setCleanup.unified.loadoutSelectionCustom'
                : 'setCleanup.unified.loadoutSelectionHint'
            )}
          </Typography>
          <Box display="flex" gap={1} flexWrap="wrap">
            <Button size="small" onClick={() => select(undefined)}>
              {t('setCleanup.unified.selectSuggested')}
            </Button>
            <Button
              size="small"
              onClick={() => select(checkable.map(({ id }) => id))}
            >
              {t('setCleanup.unified.all')}
            </Button>
            <Button size="small" onClick={() => select([])}>
              {t('setCleanup.unified.none')}
            </Button>
          </Box>
          <Box sx={{ maxHeight: 400, overflow: 'auto' }}>
            {teams.map((team) => (
              <Box key={team} sx={{ mb: 1 }}>
                <Typography variant="subtitle2">{team}</Typography>
                {options
                  .filter(({ teamName }) => teamName === team)
                  .map((option) => (
                    <Box key={option.id} sx={{ pl: 1 }}>
                      <FormControlLabel
                        disabled={!!option.reason}
                        control={
                          <Checkbox
                            size="small"
                            checked={!option.reason && selected.has(option.id)}
                            onChange={(_, checked) =>
                              toggle(option.id, checked)
                            }
                          />
                        }
                        label={[
                          charLabel(option.characterKey),
                          option.buildName,
                          option.suggested
                            ? t('setCleanup.unified.suggested')
                            : '',
                          option.reason
                            ? t(`setCleanup.skipReason.${option.reason}`)
                            : '',
                        ]
                          .filter(Boolean)
                          .join(' / ')}
                      />
                      {!!option.duplicates?.length && (
                        <Typography
                          variant="caption"
                          display="block"
                          sx={{ pl: 4 }}
                        >
                          {t('setCleanup.unified.duplicates', {
                            names: option.duplicates
                              .map(
                                ({ teamName, buildName }) =>
                                  `${teamName} / ${buildName}`
                              )
                              .join(', '),
                          })}
                        </Typography>
                      )}
                    </Box>
                  ))}
              </Box>
            ))}
          </Box>
        </Stack>
      </AccordionDetails>
    </Accordion>
  )
}

function CleanupCharacterName({
  characterKey,
  gender,
}: {
  characterKey: CleanupCharacterKey
  gender: GenderKey
}) {
  return isCharacterKey(characterKey) ? (
    <CharacterName characterKey={characterKey} gender={gender} />
  ) : (
    characterKey
  )
}

function CleanupProfileEditor({
  state,
  onClose,
  onSave,
}: {
  state: CleanupProfileState
  onClose: () => void
  onSave: (profile: CleanupBuildProfile) => void
}) {
  const { t } = useTranslation(['artifact', 'artifactNames_gen', 'statKey_gen'])
  const [draft, setDraft] = useState(() => resolveCleanupProfile(state))
  const change = (value: Partial<CleanupBuildProfile>) =>
    setDraft((old) => ({ ...old, ...value }))
  const sets = [
    ...new Set([
      ...draft.setTargets.fourPieceSets,
      ...draft.setTargets.halfSets,
    ]),
  ]
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{t('setCleanup.unified.editProfile')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label={t('setCleanup.unified.profileName')}
            value={draft.name}
            onChange={(e) => change({ name: e.target.value })}
          />
          <Autocomplete
            multiple
            options={['dps', 'support', 'sustain'] as const}
            value={draft.roles}
            onChange={(_, roles) => change({ roles })}
            renderInput={(params) => (
              <TextField {...params} label={t('setCleanup.unified.roles')} />
            )}
          />
          <Autocomplete
            multiple
            options={[...allArtifactSetKeys]}
            value={sets}
            getOptionLabel={(key) => t(`artifactNames_gen:${key}`)}
            onChange={(_, keys) =>
              change({
                setTargets: {
                  fourPieceSets: keys.filter(
                    (key) => !draft.setTargets.halfSets.includes(key)
                  ),
                  halfSets: keys.filter((key) =>
                    draft.setTargets.halfSets.includes(key)
                  ),
                  halfSetFamilies: draft.setTargets.halfSetFamilies,
                },
              })
            }
            renderInput={(params) => (
              <TextField
                {...params}
                label={t('setCleanup.unified.profileSets')}
              />
            )}
          />
          {(['sands', 'goblet', 'circlet'] as const).map((slot) => (
            <Box key={slot}>
              <Autocomplete
                multiple
                options={[...artSlotMainKeys[slot]] as MainStatKey[]}
                value={Object.entries(draft.mainStatWeights[slot] ?? {})
                  .filter(([, weight]) => (weight ?? 0) > 0)
                  .map(([key]) => key as MainStatKey)}
                getOptionLabel={(key) => t(`statKey_gen:${key}`)}
                onChange={(_, keys) =>
                  change({
                    mainStatWeights: {
                      ...draft.mainStatWeights,
                      [slot]: Object.fromEntries(
                        keys.map((key) => [
                          key,
                          draft.mainStatWeights[slot]?.[key] || 100,
                        ])
                      ),
                    },
                  })
                }
                renderInput={(params) => (
                  <TextField {...params} label={t(`slotName.${slot}`)} />
                )}
              />
              <Box display="flex" gap={1} flexWrap="wrap" mt={1}>
                {Object.entries(draft.mainStatWeights[slot] ?? {}).map(
                  ([key, weight]) => (
                    <TextField
                      key={key}
                      type="number"
                      size="small"
                      sx={{ width: 160 }}
                      label={t(`statKey_gen:${key}`)}
                      value={weight}
                      inputProps={{ min: 0, max: 100 }}
                      onChange={(e) =>
                        change({
                          mainStatWeights: {
                            ...draft.mainStatWeights,
                            [slot]: {
                              ...draft.mainStatWeights[slot],
                              [key]: Math.min(
                                100,
                                Math.max(0, Number(e.target.value))
                              ),
                            },
                          },
                        })
                      }
                    />
                  )
                )}
              </Box>
            </Box>
          ))}
          <Typography>{t('setCleanup.unified.substatWeights')}</Typography>
          <Grid container spacing={1}>
            {allSubstatKeys.map((key) => (
              <Grid item xs={6} sm={4} key={key}>
                <TextField
                  fullWidth
                  type="number"
                  size="small"
                  label={t(`statKey_gen:${key}`)}
                  value={draft.substatWeights[key] ?? 0}
                  inputProps={{ min: 0, max: 100 }}
                  onChange={(e) =>
                    change({
                      substatWeights: {
                        ...draft.substatWeights,
                        [key]: Math.min(
                          100,
                          Math.max(0, Number(e.target.value))
                        ),
                      },
                    })
                  }
                />
              </Grid>
            ))}
          </Grid>
          <TextField
            type="number"
            label={t('setCleanup.unified.mustPresent')}
            value={draft.mustPresentWeightThreshold}
            inputProps={{ min: 0, max: 100 }}
            onChange={(e) =>
              change({
                mustPresentWeightThreshold: Math.min(
                  100,
                  Math.max(0, Number(e.target.value))
                ),
              })
            }
          />
          <Typography variant="caption">
            {t('setCleanup.unified.editHint')}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('setCleanup.unified.cancel')}</Button>
        <Button variant="contained" onClick={() => onSave(draft)}>
          {t('setCleanup.unified.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
