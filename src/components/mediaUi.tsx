import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Badge } from './ui'
import type { ContentSlide } from '../lib/content'

const PLATFORM_TONE: Record<string, 'green' | 'blue' | 'orange'> = {
  linkedin: 'blue', instagram: 'green', facebook: 'blue', youtube: 'orange',
}

export function PlatformBadge({ platform }: { platform: string }) {
  return <Badge tone={PLATFORM_TONE[platform?.toLowerCase()] ?? 'blue'}>{platform}</Badge>
}

export function CarouselViewer({ slides }: { slides: ContentSlide[] }) {
  const [index, setIndex] = useState(0)
  if (!slides || slides.length === 0) return null
  const slide = slides[index]

  return (
    <div className="relative">
      <img src={slide.url} alt={slide.title} className="w-full h-56 object-cover rounded-lg" />
      {slides.length > 1 && (
        <>
          <button
            onClick={() => setIndex((i) => (i - 1 + slides.length) % slides.length)}
            className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 rounded-full p-1.5 text-white hover:bg-black/70"
            aria-label="Previous slide"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => setIndex((i) => (i + 1) % slides.length)}
            className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 rounded-full p-1.5 text-white hover:bg-black/70"
            aria-label="Next slide"
          >
            <ChevronRight size={16} />
          </button>
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
            {slides.map((_, i) => (
              <button
                key={i}
                onClick={() => setIndex(i)}
                className="h-1.5 rounded-full transition-all"
                style={{ width: i === index ? 16 : 6, background: i === index ? '#B1D997' : 'rgba(255,255,255,0.5)' }}
                aria-label={`Slide ${i + 1}`}
              />
            ))}
          </div>
        </>
      )}
      {slide.caption && <div className="text-muted text-xs mt-2">{slide.caption}</div>}
    </div>
  )
}
