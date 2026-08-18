const DIACRITICS_PATTERN = /[\u0300-\u036f]/g
const NON_ALPHANUMERIC_PATTERN = /[^a-z0-9]+/g
const EDGE_HYPHENS_PATTERN = /^-+|-+$/g
const WORK_ID_PATTERN = /(OL\d+W)$/

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(DIACRITICS_PATTERN, '')
    .replace(NON_ALPHANUMERIC_PATTERN, '-')
    .replace(EDGE_HYPHENS_PATTERN, '')
}

export function bookSlug(title: string, id: string): string {
  return `${slugify(title)}-${id}`
}

export function extractIdFromSlug(slug: string): string | null {
  return slug.match(WORK_ID_PATTERN)?.[1] ?? null
}