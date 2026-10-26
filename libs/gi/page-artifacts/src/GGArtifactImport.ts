import type {
  ArtifactSetKey,
  MainStatKey,
  SubstatKey,
} from '@genshin-optimizer/gi/consts'
import {
  allArtifactSetKeys,
  allMainStatKeys,
  allSubstatKeys,
} from '@genshin-optimizer/gi/consts'
import type {
  ArtifactCleanupConfig,
  CleanupBuildProfile,
  CleanupCharacterKey,
  CleanupProfileState,
  CleanupRole,
  CleanupSetTargets,
  CleanupStyle,
} from '@genshin-optimizer/gi/db'
import { allCleanupCharacterKeys } from '@genshin-optimizer/gi/db'

type JsonRecord = Record<string, unknown> & {
  artifactSet?: unknown
  artifactSets?: unknown
  artifactBuilds?: unknown
  buildId?: unknown
  buildName?: unknown
  builds?: unknown
  character?: unknown
  characterBuilds?: unknown
  characterId?: unknown
  characterKey?: unknown
  circletWeights?: unknown
  composition?: unknown
  computeOptions?: unknown
  format?: JsonRecord
  formatVersion?: unknown
  gobletWeights?: unknown
  halfSet1?: unknown
  halfSet2?: unknown
  id?: unknown
  kOverride?: unknown
  key?: unknown
  name?: unknown
  mustPresentWeightThreshold?: unknown
  normalizer?: unknown
  options?: unknown
  profiles?: unknown
  roles?: unknown
  sandsWeights?: unknown
  set?: unknown
  source?: unknown
  stat?: unknown
  styles?: unknown
  substatWeightThreshold?: unknown
  substats?: unknown
  title?: unknown
  uuid?: unknown
  value?: unknown
  version?: unknown
  visible?: unknown
  weight?: unknown
  _id?: unknown
}

export type GGArtifactImportPreview = {
  config?: ArtifactCleanupConfig
  version?: number
  new: number
  updated: number
  unchanged: number
  invalid: number
  stale: number
  warnings: string[]
}

const characterAliases: Record<string, CleanupCharacterKey> = {
  kazuha: 'KaedeharaKazuha',
  kokomi: 'SangonomiyaKokomi',
  raiden: 'RaidenShogun',
  sara: 'KujouSara',
  yae: 'YaeMiko',
  ayaka: 'KamisatoAyaka',
  ayato: 'KamisatoAyato',
  childe: 'Tartaglia',
  heizou: 'ShikanoinHeizou',
  yun: 'YunJin',
}

const setAliases: Record<string, ArtifactSetKey> = {
  glad: 'GladiatorsFinale',
  shimenawa: 'ShimenawasReminiscence',
  emblem: 'EmblemOfSeveredFate',
  noblesse: 'NoblesseOblige',
  vv: 'ViridescentVenerer',
  tenacity: 'TenacityOfTheMillelith',
  golden: 'GoldenTroupe',
  mh: 'MarechausseeHunter',
  obsidian: 'ObsidianCodex',
}

const statAliases: Record<string, MainStatKey> = {
  cr: 'critRate_',
  crit: 'critRate_',
  critrate: 'critRate_',
  critratepercent: 'critRate_',
  cd: 'critDMG_',
  critdmg: 'critDMG_',
  critdamage: 'critDMG_',
  critdmgpercent: 'critDMG_',
  er: 'enerRech_',
  energyrecharge: 'enerRech_',
  energyrechargepercent: 'enerRech_',
  em: 'eleMas',
  elementalmastry: 'eleMas',
  elementalmastery: 'eleMas',
  atkpercent: 'atk_',
  attackpercent: 'atk_',
  hppercent: 'hp_',
  healthpercent: 'hp_',
  defpercent: 'def_',
  defensepercent: 'def_',
  healingbonus: 'heal_',
  healbonus: 'heal_',
  physical: 'physical_dmg_',
  phys: 'physical_dmg_',
  physicaldamage: 'physical_dmg_',
  anemo: 'anemo_dmg_',
  anemodamage: 'anemo_dmg_',
  geo: 'geo_dmg_',
  geodamage: 'geo_dmg_',
  electro: 'electro_dmg_',
  electrodamage: 'electro_dmg_',
  hydro: 'hydro_dmg_',
  hydrodamage: 'hydro_dmg_',
  pyro: 'pyro_dmg_',
  pyrodmg: 'pyro_dmg_',
  pyrodmgbonus: 'pyro_dmg_',
  cryo: 'cryo_dmg_',
  cryodamage: 'cryo_dmg_',
  dendro: 'dendro_dmg_',
  dendrodamage: 'dendro_dmg_',
  hp: 'hp',
  attack: 'atk',
  atk: 'atk',
  defense: 'def_',
  def: 'def_',
}

const knownHalfSetFamilies = new Map<string, string>([
  ['cryo15', 'cryo-dmg-15'],
  ['cryo-dmg-15', 'cryo-dmg-15'],
  ['atk18', 'atk%-18'],
  ['atk', 'atk%-18'],
  ['atkpercent18', 'atk%-18'],
  ['attackpercent18', 'atk%-18'],
  ['hp20', 'hp%-20'],
  ['hp', 'hp%-20'],
  ['hppercent20', 'hp%-20'],
  ['healthpercent20', 'hp%-20'],
  ['def30', 'def%-30'],
  ['defpercent30', 'def%-30'],
  ['electro15', 'electro-dmg-15'],
  ['electrores40', 'electro-res-40'],
  ['geo15', 'geo-dmg-15'],
  ['er20', 'er-20'],
  ['er', 'er-20'],
  ['energyrecharge20', 'er-20'],
  ['em80', 'em-80'],
  ['em', 'em-80'],
  ['elementalmastery80', 'em-80'],
  ['elementaldmg15', 'elemental-dmg-15'],
  ['elemental', 'elemental-dmg-15'],
  ['elementaldamage15', 'elemental-dmg-15'],
  ['burstdmg20', 'burst-dmg-20'],
  ['phys25', 'physical-dmg-25'],
  ['physical25', 'physical-dmg-25'],
  ['hydro15', 'hydro-dmg-15'],
  ['heal15', 'heal-15'],
  ['pyrores40', 'pyro-res-40'],
  ['pyro15', 'pyro-dmg-15'],
  ['anemo15', 'anemo-dmg-15'],
  ['shield35', 'shield-35'],
  ['dendro15', 'dendro-dmg-15'],
  ['nacadmg15', 'na-ca-dmg-15'],
  ['skilldmg20', 'skill-dmg-20'],
  ['skill', 'skill-dmg-20'],
  ['elementalskilldmg20', 'skill-dmg-20'],
  ['nightsoulenergy6', 'nightsoul-energy-6'],
  ['nightsouldmg15', 'nightsoul-dmg-15'],
  ['plungedmg25', 'plunge-dmg-25'],
])

/** Exact GGArtifact V5 numeric half-set identifiers, retained for old exports. */
const halfSetIdFamilies: Record<number, string> = {
  1: 'cryo-dmg-15',
  2: 'hp%-20',
  3: 'def%-30',
  4: 'electro-dmg-15',
  5: 'electro-res-40',
  6: 'geo-dmg-15',
  7: 'em-80',
  8: 'burst-dmg-20',
  9: 'atk%-18',
  10: 'physical-dmg-25',
  11: 'hydro-dmg-15',
  12: 'heal-15',
  13: 'pyro-res-40',
  14: 'pyro-dmg-15',
  15: 'er-20',
  16: 'anemo-dmg-15',
  17: 'heal-15',
  18: 'shield-35',
  19: 'dendro-dmg-15',
  20: 'na-ca-dmg-15',
  21: 'skill-dmg-20',
  22: 'nightsoul-energy-6',
  23: 'nightsoul-dmg-15',
  24: 'plunge-dmg-25',
}

/** GGArtifact family membership, including every set supported by GO. */
const halfSetFamilySets: Record<string, ArtifactSetKey[]> = {
  'atk%-18': [
    'BraveHeart',
    'EchoesOfAnOffering',
    'ResolutionOfSojourner',
    'GladiatorsFinale',
    'VermillionHereafter',
    'ShimenawasReminiscence',
    'NighttimeWhispersInTheEchoingWoods',
    'FragmentOfHarmonicWhimsy',
    'UnfinishedReverie',
    'ADayCarvedFromRisingWinds',
    'DisenchantmentInDeepShadow',
    'ScarletProof',
    'HeartOfTheFurnace',
  ],
  'em-80': [
    'Instructor',
    'WanderersTroupe',
    'GildedDreams',
    'FlowerOfParadiseLost',
    'NightOfTheSkysUnveiling',
    'AubadeOfMorningstarAndMoon',
  ],
  'er-20': [
    'Scholar',
    'TheExile',
    'EmblemOfSeveredFate',
    'SilkenMoonsSerenade',
    'CelestialGift',
  ],
  'heal-15': ['OceanHuedClam', 'MaidenBeloved', 'SongOfDaysPast'],
  'anemo-dmg-15': ['ViridescentVenerer', 'DesertPavilionChronicle'],
  'cryo-dmg-15': ['BlizzardStrayer', 'FinaleOfTheDeepGalleries'],
  'def%-30': ['HuskOfOpulentDreams', 'DefendersWill'],
  'hp%-20': ['TenacityOfTheMillelith', 'VourukashasGlow'],
  'hydro-dmg-15': ['HeartOfDepth', 'NymphsDream'],
  'na-ca-dmg-15': ['MartialArtist', 'MarechausseeHunter'],
  'physical-dmg-25': ['BloodstainedChivalry', 'PaleFlame'],
  'skill-dmg-20': ['Gambler', 'GoldenTroupe'],
  'burst-dmg-20': ['NoblesseOblige'],
  'cr-12': ['Berserker'],
  'dendro-dmg-15': ['DeepwoodMemories'],
  'electro-dmg-15': ['ThunderingFury'],
  'electro-res-40': ['Thundersoother'],
  'geo-dmg-15': ['ArchaicPetra'],
  'nightsoul-dmg-15': ['ObsidianCodex'],
  'nightsoul-energy-6': ['ScrollOfTheHeroOfCinderCity'],
  'plunge-dmg-25': ['LongNightsOath'],
  'pyro-dmg-15': ['CrimsonWitchOfFlames'],
  'pyro-res-40': ['Lavawalker'],
  'shield-35': ['RetracingBolide'],
}

const normal = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')
const characterById = new Map(
  allCleanupCharacterKeys.map((key) => [normal(key), key] as const)
)
const setById = new Map(
  allArtifactSetKeys.map((key) => [normal(key), key] as const)
)
const mainStatById = new Map(
  allMainStatKeys.map((key) => [normal(key), key] as const)
)

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined
}
function entries(value: unknown): [string, unknown][] {
  return Object.entries(record(value) ?? {})
}
function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value]
}
function knownCharacter(value: unknown): CleanupCharacterKey | undefined {
  const key = string(value)
  return key
    ? (characterAliases[normal(key)] ?? characterById.get(normal(key)))
    : undefined
}
function knownSet(value: unknown): ArtifactSetKey | undefined {
  const key = string(value)
  return key ? (setAliases[normal(key)] ?? setById.get(normal(key))) : undefined
}
function knownStat(value: unknown): MainStatKey | undefined {
  const key = string(value)
  if (!key) return undefined
  const percentKey = key.toLowerCase().replace(/\s/g, '')
  if (percentKey === 'atk%' || percentKey === 'attack%') return 'atk_'
  if (percentKey === 'hp%' || percentKey === 'health%') return 'hp_'
  if (percentKey === 'def%' || percentKey === 'defense%') return 'def_'
  return statAliases[normal(key)] ?? mainStatById.get(normal(key))
}
function knownHalfSetFamily(value: unknown): string | undefined {
  if (typeof value === 'number') return halfSetIdFamilies[value]
  const name = string(value)
  return name ? knownHalfSetFamilies.get(normal(name)) : undefined
}

function weights(
  value: unknown,
  warnings: string[],
  context: string,
  substats = false
) {
  const result: Partial<Record<MainStatKey | SubstatKey, number>> = {}
  const object = record(value)
  const values = object
    ? Object.entries(object)
    : array(value).flatMap((item) => {
        const entry = record(item)
        const stat = entry && (entry.stat ?? entry.key ?? entry.name)
        const weight = entry && (entry.weight ?? entry.value)
        return stat === undefined ? [] : [[String(stat), weight] as const]
      })
  values.forEach(([stat, weight]) => {
    if (
      !Number.isFinite(Number(weight)) ||
      Number(weight) < 0 ||
      Number(weight) > 100
    )
      warnings.push(`${context}: invalid weight for ${stat}`)
    const rawStat = normal(stat)
    const key: MainStatKey | SubstatKey | undefined =
      substats && rawStat === 'def' ? 'def' : knownStat(stat)
    if (!key) {
      warnings.push(`${context}: unknown stat “${stat}”`)
      return
    }
    result[key] = Math.max(0, Math.min(100, number(weight)))
  })
  return result
}

function roles(value: unknown): CleanupRole[] {
  return [...new Set(array(value).map((v) => String(v).toLowerCase()))].filter(
    (role): role is CleanupRole =>
      role === 'dps' || role === 'support' || role === 'sustain'
  )
}
function styles(value: unknown): CleanupStyle[] {
  return [...new Set(array(value).map((v) => String(v).toLowerCase()))].filter(
    (style): style is CleanupStyle =>
      style === 'on-field' || style === 'off-field'
  )
}

function pushSet(
  value: unknown,
  target: ArtifactSetKey[],
  warnings: string[],
  context: string
) {
  array(value).forEach((candidate) => {
    const item = record(candidate)
    const raw = item?.set ?? item?.key ?? item?.name ?? candidate
    const key = knownSet(raw)
    if (key) target.push(key)
    else if (string(raw))
      warnings.push(`${context}: unknown artifact set “${raw}”`)
  })
}

function setTargets(
  build: JsonRecord,
  warnings: string[],
  context: string
): CleanupSetTargets {
  const concrete: ArtifactSetKey[] = []
  const halfSets: ArtifactSetKey[] = []
  const families: string[] = []
  const halfSetOptions: ArtifactSetKey[][] = []
  const composition = build.composition
  const compositionText = JSON.stringify(composition ?? '').toLowerCase()
  const useHalfSets =
    /2\s*(pc|piece|\+|\/)/.test(compositionText) ||
    build.halfSet1 !== undefined ||
    build.halfSet2 !== undefined

  if (useHalfSets) {
    ;[build.halfSet1, build.halfSet2].forEach((halfSet) => {
      const choices: ArtifactSetKey[] = []
      array(halfSet).forEach((candidate) => {
        const key = knownSet(candidate)
        if (key) choices.push(key)
        else {
          const name = string(candidate)
          const family = knownHalfSetFamily(candidate)
          if (family) {
            families.push(family)
            choices.push(...(halfSetFamilySets[family] ?? []))
          } else if (name)
            warnings.push(`${context}: unknown 2-piece set family “${name}”`)
        }
      })
      halfSetOptions.push([...new Set(choices)])
      halfSets.push(...choices)
    })
  }

  const source = record(composition)
  pushSet(
    useHalfSets
      ? undefined
      : (build.artifactSet ??
          build.artifactSets ??
          build.set ??
          source?.artifactSet),
    useHalfSets ? halfSets : concrete,
    warnings,
    context
  )
  return {
    fourPieceSets: [...new Set(concrete)],
    halfSets: [...new Set(halfSets)],
    halfSetFamilies: [...new Set(families)],
    ...(useHalfSets ? { halfSetOptions } : {}),
  }
}

function buildRecords(root: JsonRecord) {
  const characterForBuild = new Map<string, unknown>()
  const fromCharacterBuilds = root.characterBuilds
  if (record(fromCharacterBuilds)) {
    entries(fromCharacterBuilds).forEach(([character, buildRefs]) =>
      array(buildRefs).forEach((build) => {
        const item = record(build)
        const id = string(item?.id ?? item?.buildId ?? build)
        if (id) characterForBuild.set(id, character)
      })
    )
  }
  const roots = [root.builds, root.artifactBuilds, root.profiles]
  if (Array.isArray(fromCharacterBuilds)) roots.push(fromCharacterBuilds)
  const found: JsonRecord[] = []
  roots.forEach((collection) =>
    (record(collection)
      ? entries(collection).map(([id, build]) => {
          const item = record(build)
          return item && item.id === undefined ? { ...item, id } : item
        })
      : array(collection)
    ).forEach((candidate) => {
      const item = record(candidate)
      if (item) found.push(item)
    })
  )
  if (!found.length && record(fromCharacterBuilds)) {
    entries(fromCharacterBuilds).forEach(([character, collection]) =>
      array(collection).forEach((candidate) => {
        const item = record(candidate)
        if (item && (item.substats || item.sandsWeights || item.artifactSet))
          found.push({ ...item, character: item.character ?? character })
      })
    )
  }
  return { found, characterForBuild }
}

function equivalent(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Parses GGArtifact configuration format 5 without relying on a server. */
export function previewGGArtifactImport(
  input: unknown,
  current: ArtifactCleanupConfig
): GGArtifactImportPreview {
  const root = record(input)
  if (!root)
    return {
      new: 0,
      updated: 0,
      unchanged: 0,
      invalid: 1,
      stale: 0,
      warnings: ['The selected file is not a JSON object.'],
    }
  const version = number(
    root.version ?? root.formatVersion ?? root.format?.version,
    -1
  )
  if (version !== 5)
    return {
      new: 0,
      updated: 0,
      unchanged: 0,
      invalid: 0,
      stale: 0,
      version,
      warnings: [
        `GGArtifact format version ${version} is not supported; expected version 5.`,
      ],
    }

  const warnings: string[] = []
  const existing = new Map(
    current.profiles.flatMap((state) =>
      state.ggBuildId ? [[state.ggBuildId, state] as const] : []
    )
  )
  const { found, characterForBuild } = buildRecords(root)
  const globalComputeOptions = record(root.computeOptions) ?? {}
  const importedIds = new Set<string>()
  const imported: CleanupProfileState[] = []
  let created = 0
  let updated = 0
  let unchanged = 0
  let invalid = 0

  found.forEach((build, index) => {
    const id = string(build.id ?? build.buildId ?? build.uuid ?? build._id)
    if (!id) {
      invalid++
      warnings.push(`Build ${index + 1}: missing stable build ID.`)
      return
    }
    if (importedIds.has(id)) {
      invalid++
      warnings.push(`Build ${id}: duplicate build ID.`)
      return
    }
    importedIds.add(id)
    const characterValue =
      build.character ??
      build.characterKey ??
      build.characterId ??
      characterForBuild.get(id)
    const characterKey = knownCharacter(characterValue)
    if (!characterKey) {
      invalid++
      warnings.push(
        `Build ${id}: unknown character “${String(characterValue ?? '')}”.`
      )
      return
    }
    const options = {
      ...globalComputeOptions,
      ...record(build.computeOptions),
      ...record(build.options),
    }
    const context = `Build ${id}`
    const profile: CleanupBuildProfile = {
      id,
      characterKey,
      name:
        string(build.name ?? build.buildName ?? build.title) ??
        `GGArtifact ${id}`,
      active: build.visible === undefined ? true : Boolean(build.visible),
      roles: roles(build.roles),
      styles: styles(build.styles),
      setTargets: setTargets(build, warnings, context),
      mainStatWeights: {
        sands: weights(build.sandsWeights, warnings, context) as Partial<
          Record<MainStatKey, number>
        >,
        goblet: weights(build.gobletWeights, warnings, context) as Partial<
          Record<MainStatKey, number>
        >,
        circlet: weights(build.circletWeights, warnings, context) as Partial<
          Record<MainStatKey, number>
        >,
      },
      substatWeights: Object.fromEntries(
        Object.entries(weights(build.substats, warnings, context, true)).filter(
          ([stat]) => allSubstatKeys.includes(stat as SubstatKey)
        )
      ) as Partial<Record<SubstatKey, number>>,
      kOverride:
        build.kOverride === undefined && options.kOverride === undefined
          ? undefined
          : Math.max(
              0,
              Math.floor(number(build.kOverride ?? options.kOverride))
            ),
      substatWeightThreshold: Math.max(
        0,
        number(build.substatWeightThreshold ?? options.substatWeightThreshold)
      ),
      mustPresentWeightThreshold: Math.max(
        0,
        number(
          build.mustPresentWeightThreshold ?? options.mustPresentWeightThreshold
        )
      ),
      source: string(build.source),
      normalizer:
        build.normalizer === undefined ? undefined : number(build.normalizer),
    }
    // Preserve the export's filter expansions before applying local overrides.
    if (options['expandElementalGoblet'] === true) {
      const elemental = allMainStatKeys.filter(
        (key) => key.endsWith('_dmg_') && key !== 'physical_dmg_'
      )
      const weight = Math.max(
        0,
        ...elemental.map((key) => profile.mainStatWeights.goblet?.[key] ?? 0)
      )
      if (weight > 0)
        for (const key of elemental)
          profile.mainStatWeights.goblet![key] = weight
    }
    if (
      options['expandCritCirclet'] === true &&
      profile.setTargets.fourPieceSets.length
    ) {
      const weight = Math.max(
        profile.mainStatWeights.circlet?.critRate_ ?? 0,
        profile.mainStatWeights.circlet?.critDMG_ ?? 0
      )
      if (weight > 0)
        Object.assign(profile.mainStatWeights.circlet!, {
          critRate_: weight,
          critDMG_: weight,
        })
    }
    if (
      build.composition !== undefined &&
      build.composition !== '4pc' &&
      build.composition !== '2pc+2pc'
    )
      warnings.push(`${context}: unsupported composition`)
    const old = existing.get(id)
    const state: CleanupProfileState = {
      ggBuildId: id,
      base: profile,
      overrides: old?.overrides,
      stale: false,
    }
    if (!old) created++
    else if (equivalent(old.base, profile) && !old.stale) unchanged++
    else updated++
    imported.push(state)
  })

  const staleProfiles = current.profiles
    .filter(
      (profile) => profile.ggBuildId && !importedIds.has(profile.ggBuildId)
    )
    .map((profile) => ({
      ...profile,
      stale: true,
      base: { ...profile.base, active: false },
    }))
  const manualProfiles = current.profiles.filter(
    (profile) => !profile.ggBuildId
  )
  return {
    version,
    new: created,
    updated,
    unchanged,
    invalid,
    stale: staleProfiles.length,
    warnings,
    config: {
      ...current,
      goProfileCoverage: Object.fromEntries(
        Object.entries(current.goProfileCoverage).filter(([id]) => {
          const old = existing.get(id)
          const next = imported.find(({ base }) => base.id === id)
          // A changed profile needs its coverage confirmed again.
          return !old || Boolean(next && equivalent(old.base, next.base))
        })
      ),
      profiles: [...manualProfiles, ...imported, ...staleProfiles],
      importWarnings: [
        ...warnings,
        ...(invalid
          ? [
              String(invalid) +
                ' imported build(s) could not be read; coverage needs review.',
            ]
          : []),
      ],
    },
  }
}
