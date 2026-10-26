import { render, screen } from '@testing-library/react'
import i18next from 'i18next'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ErrorBoundary from './index'

vi.hoisted(() => {
  vi.stubEnv('NODE_ENV', 'development')
})

vi.mock('@genshin-optimizer/common/ui', () => ({
  CardThemed: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@genshin-optimizer/gi/theme', async () => {
  const { createTheme } = await import('@mui/material/styles')
  return { theme: createTheme() }
})

vi.mock('@genshin-optimizer/gi/ui', () => ({
  DatabaseCard: () => <div>Database backup</div>,
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('ErrorBoundary', () => {
  it('shows the error and database backup when a page crashes in development', async () => {
    const i18n = i18next.createInstance()
    await i18n.init({
      lng: 'en',
      resources: {
        en: { page_error: { title: 'Page could not be loaded' } },
      },
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    function BrokenPage(): never {
      throw new Error('Team page failed')
    }

    render(
      <I18nextProvider i18n={i18n}>
        <ErrorBoundary>
          <BrokenPage />
        </ErrorBoundary>
      </I18nextProvider>
    )

    expect(screen.getByText('Page could not be loaded')).toBeTruthy()
    expect(screen.getByText('Database backup')).toBeTruthy()
    expect(screen.getByRole('textbox').textContent).toContain(
      'Team page failed'
    )
  })
})
