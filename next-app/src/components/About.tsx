'use client'

import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import 'github-markdown-css/github-markdown-light.css'
import '../styles/About.css'

const ABOUT_URL =
  'https://raw.githubusercontent.com/queenleoa/mendel/60a0a4093a097bdd113e94b47a9b78284e5fdfa6/ABOUT.md'

const GITHUB_URL =
  'https://github.com/queenleoa/mendel/blob/60a0a4093a097bdd113e94b47a9b78284e5fdfa6/ABOUT.md'

export default function About() {
  const [content, setContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch(ABOUT_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.text()
      })
      .then((text) => {
        if (!cancelled) {
          setContent(text)
          setLoading(false)
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="about-container">
      <div className="about-toolbar">
        <a
          className="btn btn-ghost"
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          View on GitHub ↗
        </a>
      </div>

      <article className="about-card">
        {loading && <p className="about-status">Loading…</p>}
        {error && (
          <p className="about-status about-error">
            Couldn't load ABOUT.md ({error}). You can read it{' '}
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
              on GitHub
            </a>
            .
          </p>
        )}
        {!loading && !error && (
          <div className="markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        )}
      </article>
    </div>
  )
}
