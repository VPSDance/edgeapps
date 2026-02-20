// Client-side API helpers for Admin SPA
import { useState, useEffect, useCallback } from 'react'
import type { LinkData, CreateLinkInput, UpdateLinkInput } from './types'

// ---------- Types ----------

interface LinksResult {
  links: LinkData[]
  total: number
}

interface TagsResult {
  tags: string[]
}

export interface AdminEntry {
  id: string
  label: string
  path: string
  description?: string
  iframePath?: string
}

interface AdminEntriesResult {
  entries: AdminEntry[]
}

// ---------- Generic fetch hook ----------

export function useApiQuery<T>(url: string) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(url)
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      const json = await res.json()
      setData(json as T)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [url])

  useEffect(() => {
    refetch()
  }, [refetch])

  return { data, loading, error, refetch }
}

// ---------- Mutation helpers ----------

async function apiFetch<T>(url: string, options: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

export async function apiCreateLink(input: CreateLinkInput): Promise<LinkData> {
  return apiFetch('/_/api/links', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function apiUpdateLink(code: string, input: UpdateLinkInput): Promise<LinkData> {
  return apiFetch(`/_/api/links/${code}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

export async function apiDeleteLink(code: string): Promise<void> {
  const res = await fetch(`/_/api/links/${code}`, { method: 'DELETE' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
}

// ---------- Pre-typed hooks ----------

export function useLinks(search?: string, tag?: string) {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (tag) params.set('tag', tag)
  params.set('limit', '100')
  const qs = params.toString()
  return useApiQuery<LinksResult>(`/_/api/links${qs ? `?${qs}` : ''}`)
}

export function useLink(code: string) {
  return useApiQuery<LinkData>(`/_/api/links/${code}`)
}

export function useTags() {
  return useApiQuery<TagsResult>('/_/api/tags')
}

export function usePluginAdminEntries() {
  return useApiQuery<AdminEntriesResult>('/_/api/plugin/admin-entries')
}
