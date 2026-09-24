"use client"

import { useState } from "react"

import { safeUrl } from "@/lib/format"

/**
 * Image hosted by the news site, loaded straight from it.
 *
 * Not next/image on purpose: the sources are arbitrary hosts, so the optimizer
 * would need a `https://**` remotePattern, turning this app into an open image
 * proxy (and spending the Vercel Hobby optimization quota). The global
 * Referrer-Policy: no-referrer keeps the app URL from leaking to those hosts.
 * Hotlink-protected or deleted images simply disappear instead of showing a
 * broken icon.
 */
export function ExternalImage({ src, alt, className }: { src: string | null | undefined; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  const url = safeUrl(src)
  if (!url?.startsWith("https://") || failed) return null
  return (
    // eslint-disable-next-line @next/next/no-img-element -- see component comment
    <img
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  )
}

/** In-article chart/table/diagram with its caption; the whole figure hides if the image fails. */
export function ExternalFigure({ src, caption, label }: { src: string; caption: string; label: string }) {
  const [failed, setFailed] = useState(false)
  const url = safeUrl(src)
  if (!url?.startsWith("https://") || failed) return null
  return (
    <figure className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800">
      {/* Charts are often too small to read inline: open the original full size. */}
      <a href={url} target="_blank" rel="noopener noreferrer nofollow" title="Abrir a tamaño completo">
        {/* eslint-disable-next-line @next/next/no-img-element -- see ExternalImage */}
        <img
          src={url}
          alt={label}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="mx-auto max-h-[36rem] w-auto max-w-full object-contain"
        />
      </a>
      <figcaption className="border-t border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        {caption}
      </figcaption>
    </figure>
  )
}
