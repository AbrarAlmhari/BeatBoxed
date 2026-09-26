import { Compass, Home, Library, User } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type NavItem = {
  label: string
  to: string
  icon: LucideIcon
}

// Single source of truth for both the bottom tab bar and the sidebar.
// Per design-system.md: no search icon here — search lives inside Explore.
export const NAV_ITEMS: NavItem[] = [
  { label: 'Home', to: '/', icon: Home },
  { label: 'Explore', to: '/explore', icon: Compass },
  { label: 'Library', to: '/library', icon: Library },
  { label: 'Profile', to: '/profile', icon: User },
]
