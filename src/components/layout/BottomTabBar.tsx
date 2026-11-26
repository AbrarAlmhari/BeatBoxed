import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { ChevronRight, ListPlus, PenLine, Plus } from 'lucide-react'
import { NAV_ITEMS, type NavItem } from '@/lib/nav'
import { cn } from '@/lib/cn'
import { useTapToTop } from '@/lib/scroll'
import { useCreate } from '@/lib/create'
import { Sheet } from '@/components/ui/Sheet'
import { BeatieImage } from '@/components/beatie/BeatieImage'

/**
 * Phone only. Hidden from `md` up, where Sidebar takes over.
 *
 * Five slots: the four tabs with Create in the middle. Solid (nothing
 * shows through), 60px tall plus the phone's home-indicator space.
 */
export function BottomTabBar() {
  const [left, right] = [NAV_ITEMS.slice(0, 2), NAV_ITEMS.slice(2)]
  return (
    <nav
      className="light-edge fixed inset-x-0 bottom-0 z-40 border-t border-line bg-background md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      aria-label="Primary"
      data-bottom-bar
    >
      <ul className="flex h-[60px] items-stretch">
        {left.map((item) => (
          <Tab key={item.to} item={item} />
        ))}
        <li className="flex flex-1 items-center justify-center">
          <CreateButton />
        </li>
        {right.map((item) => (
          <Tab key={item.to} item={item} />
        ))}
      </ul>
    </nav>
  )
}

function Tab({ item: { label, to, icon: Icon } }: { item: NavItem }) {
  const tapToTop = useTapToTop()
  return (
    <li className="flex-1">
      <NavLink
        to={to}
        end
        onClick={tapToTop(to)}
        data-tour={`nav-${label.toLowerCase()}`}
        className={({ isActive }) =>
          cn(
            'flex h-full flex-col items-center justify-center gap-0.5 px-1 transition-colors duration-200 ease-soft',
            'active:scale-[0.94] motion-safe:transition-transform',
            isActive ? 'text-foreground' : 'text-tab-idle'
          )
        }
      >
        {({ isActive }) => (
          <>
            <span
              className={cn(
                'grid place-items-center rounded-full px-3.5 py-0.5 transition-[background-color,box-shadow] duration-200',
                isActive
                  ? 'bg-primary/15 shadow-[0_0_16px_-3px_rgb(139_92_246/0.55),inset_0_1px_0_rgb(255_255_255/0.06)]'
                  : 'bg-transparent'
              )}
            >
              <Icon
                className={cn(
                  'size-[21px] transition-colors duration-200',
                  isActive && 'text-primary drop-shadow-[0_0_6px_rgb(139_92_246/0.7)]'
                )}
                strokeWidth={isActive ? 2.25 : 1.75}
              />
            </span>
            <span className={cn('text-[11px] leading-none', isActive ? 'font-semibold' : 'font-medium')}>{label}</span>
          </>
        )}
      </NavLink>
    </li>
  )
}

/** The gradient square in the middle: opens "Create". */
function CreateButton() {
  const [open, setOpen] = useState(false)
  const create = useCreate()
  const navigate = useNavigate()
  const go = (fn: () => void) => () => {
    setOpen(false)
    fn()
  }
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Create"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-tour="composer"
        className="tap-44 grid h-[38px] w-[46px] place-items-center rounded-[14px] bg-[linear-gradient(135deg,#8b5cf6,#6d28d9)] text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_4px_16px_-4px_rgb(139_92_246/0.8)] transition-transform duration-200 ease-soft active:scale-95"
      >
        <Plus className="size-[22px]" strokeWidth={2.5} aria-hidden />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Create" align="start">
        <div className="flex flex-col gap-1">
          <CreateRow
            icon={<PenLine className="size-[22px] text-[#c4b5fd]" strokeWidth={1.9} aria-hidden />}
            tint="bg-primary/20"
            title="Write a review"
            subtitle="Rate a song and say what you hear"
            onClick={go(create.openComposer)}
          />
          <CreateRow
            icon={<ListPlus className="size-[22px] text-[#6ee7b7]" strokeWidth={1.9} aria-hidden />}
            tint="bg-success/15"
            title="New playlist"
            subtitle="Collect songs in one place"
            onClick={go(() => navigate('/library?new=1'))}
          />
          <CreateRow
            icon={<BeatieImage mood="mark" size={26} />}
            tint="bg-like/15"
            title="Ask Beatie"
            subtitle="Ask about any song"
            onClick={go(create.openBeatie)}
          />
        </div>
      </Sheet>
    </div>
  )
}

function CreateRow({
  icon,
  tint,
  title,
  subtitle,
  onClick,
}: {
  icon: React.ReactNode
  tint: string
  title: string
  subtitle: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-16 items-center gap-3.5 rounded-tile px-2 py-2 text-start transition-colors duration-200 ease-soft hover:bg-white/5"
    >
      <span className={cn('grid size-[46px] shrink-0 place-items-center rounded-tile', tint)}>{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[15px] font-semibold text-foreground">{title}</span>
        <span className="text-[13px] text-muted-foreground">{subtitle}</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden />
    </button>
  )
}
