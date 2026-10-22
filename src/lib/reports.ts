import { supabase } from './supabase'

/** Why a profile is reported (profile_reports.reason, 0050). */
export type ReportReason = 'spam' | 'harassment' | 'hate' | 'inappropriate' | 'other'

export const REPORT_REASONS: { id: ReportReason; label: string }[] = [
  { id: 'spam', label: 'Spam' },
  { id: 'harassment', label: 'Harassment' },
  { id: 'hate', label: 'Hate' },
  { id: 'inappropriate', label: 'Inappropriate content' },
  { id: 'other', label: 'Something else' },
]

/**
 * Files a report as the signed-in person. 'already' when they have an open
 * report about this profile; nothing is read back (nobody can read reports
 * from the app, their own included).
 */
export async function reportProfile(
  reporterId: string,
  reportedId: string,
  reason: ReportReason,
  details: string
): Promise<'sent' | 'already'> {
  if (!supabase) throw new Error('Supabase is not configured')
  const text = details.trim()
  const { error } = await supabase.from('profile_reports').insert({
    reporter_id: reporterId,
    reported_id: reportedId,
    reason,
    details: text ? text.slice(0, 500) : null,
  })
  if (error?.code === '23505') return 'already'
  if (error) throw error
  return 'sent'
}
