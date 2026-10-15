import { useEffect, useState } from 'react'
import { BeatieChat } from './BeatieChat'
import { BeatieImage } from './BeatieImage'
import { Card } from '@/components/ui/Card'

/**
 * Beatie's card on the Song page: Beatie's face and name, then the shared
 * chat. The face is the normal one until an answer arrives, then happy.
 */
export function BeatieCard({ songId }: { songId: string }) {
  const [answered, setAnswered] = useState(false)
  useEffect(() => setAnswered(false), [songId])

  return (
    <Card className="flex flex-col gap-4 sm:p-5">
      <div className="flex items-center gap-3">
        <BeatieImage mood={answered ? 'happy' : 'default'} size={48} />
        <div className="flex flex-col">
          <span className="text-card-title">Beatie</span>
          <span className="text-meta text-muted-foreground">Your music buddy</span>
        </div>
      </div>
      <BeatieChat songId={songId} onAnswered={() => setAnswered(true)} />
    </Card>
  )
}
