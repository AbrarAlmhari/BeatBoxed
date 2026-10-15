import type { ReactNode } from 'react'
import { Logo } from '@/components/ui/Logo'
import { BeatieImage } from '@/components/beatie/BeatieImage'
import { Card } from '@/components/ui/Card'
import { PageGlow } from '@/components/ui/PageGlow'

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
    <div className="relative isolate flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-background px-4 py-10 sm:px-6">
      <PageGlow strength="soft" className="inset-x-0 top-0 sm:inset-x-0 lg:inset-x-0" />

      <main className="animate-page-in relative w-full max-w-[420px] motion-reduce:animate-none">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <BeatieImage mood="happy" size={72} />
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

        <Card padding="none" className="p-6 sm:p-7">
          {children}
        </Card>

        <p className="mt-6 text-center text-secondary text-muted-foreground">
          {footer}
        </p>
      </main>
    </div>
  )
}
