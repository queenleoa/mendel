'use client'

import { useEffect, useRef } from 'react'
import '../styles/LogTicker.css'

export type LogEntry = { ts: string; message: string }

export const stampLog = (message: string): LogEntry => ({
  ts: new Date().toLocaleTimeString(undefined, { hour12: false }),
  message,
})

type Props = {
  logs: LogEntry[]
  label?: string
  emptyHint?: string
  height?: number
  /** Fill the height of the parent flex container. Overrides `height`. */
  fill?: boolean
}

/**
 * Terminal-style scrolling log feed. Auto-scrolls to bottom when a new
 * entry lands.
 */
export default function LogTicker({
  logs,
  label = 'Activity',
  emptyHint = 'No activity yet.',
  height = 180,
  fill = false,
}: Props) {
  const ref = useRef<HTMLOListElement>(null)
  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight
    }
  }, [logs.length])
  return (
    <div className={`log-ticker-wrap ${fill ? 'fill' : ''}`}>
      <p className="log-ticker-label">{label}</p>
      <ol
        className="log-ticker"
        ref={ref}
        style={fill ? undefined : { height: `${height}px` }}
      >
        {logs.length === 0 ? (
          <li className="log-ticker-empty">{emptyHint}</li>
        ) : (
          logs.map((l, i) => (
            <li key={i}>
              <span className="log-ticker-ts">{l.ts}</span>
              <span className="log-ticker-msg">{l.message}</span>
            </li>
          ))
        )}
      </ol>
    </div>
  )
}
