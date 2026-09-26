import { MediaCard } from './MediaCard'

const SAMPLE = [
  'Midnight Static',
  'Paper Lanterns',
  'Slow Reverb',
  'Amber Hours',
  'Velvet Noise',
  'After Rain',
  'Low Tide',
  'Signal Drift',
  'Ghost Chorus',
  'Blue Hour',
  'Soft Static',
  'Night Bus',
]

export type PagePlaceholderProps = {
  title: string
  description: string
}

export function PagePlaceholder({ title, description }: PagePlaceholderProps) {
  return (
    <div className="flex flex-col gap-8 pt-2">
      <div className="flex flex-col gap-2">
        <h1 className="text-page-title">{title}</h1>
        <p className="max-w-prose text-body text-muted-foreground">
          {description}
        </p>
      </div>

      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-section-title">Placeholder rail</h2>
          <button
            type="button"
            className="rounded-button px-2 py-1 text-button text-muted-foreground transition-colors duration-200 ease-soft hover:text-accent"
          >
            See all
          </button>
        </div>

        {/* Column count steps up with width instead of stretching the phone layout. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {SAMPLE.map((name, i) => (
            <MediaCard
              key={name}
              title={name}
              subtitle={i % 2 ? 'Album' : 'Single'}
              tint={i / (SAMPLE.length - 1)}
            />
          ))}
        </div>
      </section>
    </div>
  )
}
