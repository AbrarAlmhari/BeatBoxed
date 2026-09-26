import type { ReactNode } from 'react'
import { Logo } from '@/components/ui/Logo'

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle: string
  children: ReactNode
  footer: ReactNode
}) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-10 sm:px-6">
      {/* Atmospheric wash, not a neon glow — per design-system.md. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(75%_55%_at_50%_0%,rgba(139,92,246,0.16),transparent_70%)]"
      />

      <main className="animate-page-in relative w-full max-w-[420px]">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <Logo
            variant="full"
            glow="lg"
            className="h-auto w-full max-w-[260px] sm:max-w-[288px]"
          />
          <div className="flex flex-col gap-1.5">
            <h1 className="text-page-title">{title}</h1>
            <p className="text-body text-muted-foreground">{subtitle}</p>
          </div>
        </div>

        <div className="rounded-card bg-surface p-6 shadow-card sm:p-7">
          {children}
        </div>

        <p className="mt-6 text-center text-secondary text-muted-foreground">
          {footer}
        </p>
      </main>
    </div>
  )
}
