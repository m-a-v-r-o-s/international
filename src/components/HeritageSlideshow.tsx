'use client'

import { useEffect, useState } from 'react'

const INTERVAL_MS = 4000

/**
 * Cross-fades through a fixed set of photos. A single stack of absolutely
 * positioned images sized off `aspect` keeps the box a constant height
 * across the swap — sizing each `<img>` off its own intrinsic dimensions
 * would jump the layout every few seconds as heights differ slightly.
 *
 * `decorative` mirrors how the login card uses this today (aria-hidden,
 * empty alt, image is pure atmosphere). Non-decorative use — the 404 page —
 * exposes only the on-screen slide's alt text; the others are aria-hidden
 * so a screen reader isn't handed three captions for one visible photo.
 */
export function HeritageSlideshow({
  images, decorative = false, aspect = '480/443', className = '',
}: {
  images: { src: string; alt: string; width: number; height: number }[]
  decorative?: boolean
  aspect?: string
  className?: string
}) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (images.length < 2) return
    const id = setInterval(() => setIndex((i) => (i + 1) % images.length), INTERVAL_MS)
    return () => clearInterval(id)
  }, [images.length])

  return (
    <div
      className={`relative w-full overflow-hidden ${className}`}
      style={{ aspectRatio: aspect }}
      aria-hidden={decorative || undefined}
    >
      {images.map((img, i) => {
        const active = i === index
        return (
          <img
            key={img.src}
            src={img.src}
            width={img.width}
            height={img.height}
            alt={decorative ? '' : active ? img.alt : ''}
            aria-hidden={decorative || !active ? true : undefined}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ease-ui ${
              active ? 'opacity-100' : 'opacity-0'
            }`}
          />
        )
      })}
    </div>
  )
}
