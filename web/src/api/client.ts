import type {
  Evaluation,
  Ledger,
  LiveSession,
  Meta,
  PatientRecord,
  Sensitivity,
  SensitivityChange,
  Twin,
  Worklist,
} from './types'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** Python's json module can emit bare NaN/Infinity; browsers reject those. Fall back to a tolerant parse. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    const cleaned = text.replace(/([:\[,]\s*)(-?Infinity|NaN)(?=\s*[,\]}])/g, '$1null')
    return JSON.parse(cleaned)
  }
}

async function request<T>(path: string, init?: RequestInit, signal?: AbortSignal): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      signal,
      headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError(0, 'Cannot reach the Pratirup API. Check that the server is running.')
  }
  const text = await res.text()
  if (!res.ok) {
    let detail = res.statusText || `HTTP ${res.status}`
    try {
      const body = parseJson(text) as { detail?: unknown }
      if (typeof body?.detail === 'string') detail = body.detail
      else if (body?.detail) detail = JSON.stringify(body.detail)
    } catch {
      if (text) detail = text.slice(0, 200)
    }
    throw new ApiError(res.status, detail)
  }
  try {
    return parseJson(text) as T
  } catch {
    throw new ApiError(res.status, 'The API returned a response that could not be read.')
  }
}

export const api = {
  meta: (signal?: AbortSignal) => request<Meta>('/meta', undefined, signal),
  worklist: (t: number, signal?: AbortSignal) => request<Worklist>(`/worklist?t=${t}`, undefined, signal),
  patient: (rid: string, signal?: AbortSignal) =>
    request<PatientRecord>(`/patients/${encodeURIComponent(rid)}`, undefined, signal),
  twin: (rid: string, t: number | null, windowH: number, signal?: AbortSignal) =>
    request<Twin>(
      `/patients/${encodeURIComponent(rid)}/twin?window_h=${windowH}&horizon=60${t == null ? '' : `&t=${t}`}`,
      undefined,
      signal,
    ),
  ledger: (rid: string, t: number | null, signal?: AbortSignal) =>
    request<Ledger>(`/patients/${encodeURIComponent(rid)}/ledger?horizon=60${t == null ? '' : `&t=${t}`}`, undefined, signal),
  sensitivity: (rid: string, t: number, changes: SensitivityChange[]) =>
    request<Sensitivity>(`/patients/${encodeURIComponent(rid)}/sensitivity`, {
      method: 'POST',
      body: JSON.stringify({ t, changes }),
    }),
  evaluation: (signal?: AbortSignal) => request<Evaluation>('/evaluation', undefined, signal),
  liveList: (signal?: AbortSignal) => request<{ sessions: LiveSession[] }>('/live', undefined, signal),
  liveStart: (source: string, secondsPerReading: number) =>
    request<LiveSession>('/live/start', {
      method: 'POST',
      body: JSON.stringify({ source_recording_id: source, seconds_per_reading: secondsPerReading }),
    }),
  liveStop: (rid: string) => request<LiveSession>(`/live/${encodeURIComponent(rid)}/stop`, { method: 'POST' }),
}
