export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

// e.g. bookSlug("The Picture of Dorian Gray", "OL8193416W")
//   -> "the-picture-of-dorian-gray-OL8193416W"
export function bookSlug(title: string, id: string): string {
  return `${slugify(title)}-${id}`
}

// Pulls the OpenLibrary work ID back out of a slug, regardless of the
// title portion — the ID is always the real source of truth.
export function extractIdFromSlug(slug: string): string | null {
  const match = slug.match(/(OL\d+W)$/)
  return match ? match[1] : null
}