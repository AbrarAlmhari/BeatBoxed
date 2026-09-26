import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="flex flex-col items-start gap-4 py-16">
      <h1 className="text-page-title">Page not found</h1>
      <p className="text-body text-muted-foreground">
        That route doesn't exist yet.
      </p>
      <Link
        to="/"
        className="rounded-button bg-primary px-4 py-2.5 text-button text-white transition-all duration-200 ease-soft hover:bg-accent active:scale-95"
      >
        Back to Home
      </Link>
    </div>
  )
}
