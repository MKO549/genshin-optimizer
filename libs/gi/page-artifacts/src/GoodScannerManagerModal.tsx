import { CardThemed, ModalWrapper } from '@genshin-optimizer/common/ui'
import type { ICachedArtifact } from '@genshin-optimizer/gi/db'
import CloseIcon from '@mui/icons-material/Close'
import CloudSyncIcon from '@mui/icons-material/CloudSync'
import {
  Alert,
  Box,
  Button,
  CardContent,
  CardHeader,
  Divider,
  IconButton,
  LinearProgress,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  buildGoodScannerManageTargets,
  GoodScannerError,
  type GoodScannerHealth,
  type GoodScannerManageResult,
  getGoodScannerHealth,
  getGoodScannerJobStatus,
  getGoodScannerManageResult,
  startGoodScannerManage,
} from './GoodScannerManager'

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

function localOptimizerOrigin() {
  const hostname = window.location.hostname
  return (
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  )
}

export default function GoodScannerManagerModal({
  show,
  onHide,
  artifacts,
}: {
  show: boolean
  onHide: () => void
  artifacts: ICachedArtifact[]
}) {
  const [portText, setPortText] = useState('8765')
  const [health, setHealth] = useState<GoodScannerHealth>()
  const [checking, setChecking] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string>()
  const [progress, setProgress] = useState({
    completed: 0,
    total: 0,
    phase: '',
  })
  const [result, setResult] = useState<GoodScannerManageResult>()
  const localOrigin = localOptimizerOrigin()
  const port = Number(portText)
  const targets = useMemo(
    () => buildGoodScannerManageTargets(artifacts),
    [artifacts]
  )
  const canConnect = Number.isInteger(port) && port > 0 && port <= 65535
  const canStart =
    localOrigin &&
    canConnect &&
    !!health?.enabled &&
    !health.busy &&
    health.gameAlive &&
    !targets.errors.length &&
    !!targets.targets.length &&
    !running

  const checkConnection = useCallback(async () => {
    if (!canConnect || !localOrigin) return
    setChecking(true)
    setError(undefined)
    try {
      setHealth(await getGoodScannerHealth(port))
    } catch (error) {
      setHealth(undefined)
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setChecking(false)
    }
  }, [canConnect, localOrigin, port])

  useEffect(() => {
    if (show) void checkConnection()
  }, [show, checkConnection])

  const start = async () => {
    if (!canStart) return
    setRunning(true)
    setError(undefined)
    setResult(undefined)
    setProgress({
      completed: 0,
      total: targets.targets.length,
      phase: 'Starting…',
    })
    try {
      const accepted = await startGoodScannerManage(port, targets.request)
      for (;;) {
        await delay(1000)
        const status = await getGoodScannerJobStatus(port)
        if (status.jobId && status.jobId !== accepted.jobId) {
          throw new GoodScannerError(
            'A different GOODScanner job replaced this request.'
          )
        }
        if (status.progress)
          setProgress({
            completed: status.progress.completed,
            total: status.progress.total,
            phase: status.progress.phase,
          })
        if (status.state === 'completed') break
      }
      setResult(await getGoodScannerManageResult(port, accepted.jobId))
      await checkConnection()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setRunning(false)
    }
  }

  const successful = result
    ? result.results.filter(
        ({ status }) => status === 'success' || status === 'already_correct'
      ).length
    : 0
  const percent = progress.total
    ? Math.min(100, (progress.completed / progress.total) * 100)
    : 0

  return (
    <ModalWrapper
      open={show}
      onClose={running ? undefined : onHide}
      containerProps={{ maxWidth: 'sm' }}
    >
      <CardThemed>
        <CardHeader
          title="Apply artifact lock states to Genshin"
          subheader="Uses the local GOODScanner Manager HTTP server."
          action={
            <IconButton disabled={running} onClick={onHide} aria-label="Close">
              <CloseIcon />
            </IconButton>
          }
        />
        <CardContent>
          <Stack spacing={2}>
            {!localOrigin && (
              <Alert severity="warning">
                This integration only works when Genshin Optimizer is opened
                from localhost. GOODScanner rejects requests from this public
                origin.
              </Alert>
            )}
            <Typography variant="body2">
              GOODScanner changes the game through its own UI automation. Keep
              Genshin open, start the Manager HTTP server, and do not use the
              mouse while the job is running.
            </Typography>
            <TextField
              label="GOODScanner port"
              value={portText}
              onChange={(event) => setPortText(event.target.value)}
              type="number"
              inputProps={{ min: 1, max: 65535 }}
              disabled={running}
              size="small"
            />
            <Box display="flex" alignItems="center" gap={1}>
              <Button
                disabled={!canConnect || checking || running || !localOrigin}
                onClick={checkConnection}
              >
                {checking ? 'Checking…' : 'Check connection'}
              </Button>
              {health && (
                <Typography
                  variant="body2"
                  color={
                    health.enabled && !health.busy && health.gameAlive
                      ? 'success.main'
                      : 'warning.main'
                  }
                >
                  {health.enabled ? 'Manager enabled' : 'Manager paused'} ·{' '}
                  {health.gameAlive ? 'Genshin found' : 'Genshin not found'}
                  {health.busy ? ' · Busy' : ''}
                </Typography>
              )}
            </Box>
            {!!targets.errors.length && (
              <Alert severity="error">
                {targets.errors.length} artifact
                {targets.errors.length === 1 ? '' : 's'} will not be sent.
                Resolve the conflicting or unsupported artifacts before applying
                this batch.
              </Alert>
            )}
            {!!targets.warnings.length && (
              <Alert severity="warning">
                {targets.warnings.length} identical artifact
                {targets.warnings.length === 1 ? '' : 's'} share the same
                requested state and can be processed together.
              </Alert>
            )}
            <Typography variant="body2">
              Request: {targets.request.lock.length} lock,{' '}
              {targets.request.unlock.length} unlock.
            </Typography>
            {running && (
              <Box>
                <LinearProgress variant="determinate" value={percent} />
                <Typography variant="caption">
                  {progress.completed} / {progress.total}{' '}
                  {progress.phase && `· ${progress.phase}`}
                </Typography>
              </Box>
            )}
            {error && <Alert severity="error">{error}</Alert>}
            {result && (
              <Alert
                severity={
                  result.summary.errors ||
                  result.summary.aborted ||
                  result.summary.not_found
                    ? 'warning'
                    : 'success'
                }
              >
                {successful} of {result.summary.total} artifact
                {result.summary.total === 1 ? '' : 's'} confirmed.{' '}
                {result.summary.not_found
                  ? `${result.summary.not_found} not found. `
                  : ''}
                {result.summary.errors
                  ? `${result.summary.errors} failed. `
                  : ''}
                {result.summary.aborted
                  ? `${result.summary.aborted} aborted.`
                  : ''}
              </Alert>
            )}
            {result?.results.some(({ message }) => message) && (
              <Stack spacing={0.5}>
                {result.results
                  .filter(({ message }) => message)
                  .map(({ id, message }) => (
                    <Typography
                      key={id}
                      variant="caption"
                      sx={{ whiteSpace: 'pre-wrap' }}
                    >
                      {id}: {message}
                    </Typography>
                  ))}
              </Stack>
            )}
            <Divider />
            <Box display="flex" justifyContent="flex-end" gap={1}>
              <Button disabled={running} onClick={onHide}>
                Close
              </Button>
              <Button
                color="warning"
                variant="contained"
                startIcon={<CloudSyncIcon />}
                disabled={!canStart}
                onClick={start}
              >
                Apply to Genshin
              </Button>
            </Box>
          </Stack>
        </CardContent>
      </CardThemed>
    </ModalWrapper>
  )
}
