import { useMemo, useState } from 'react'
import type { FhirBundle, PatientRecord } from '../../api/types'
import { ChevronIcon } from '../../components/icons'
import { EmptyState, ProvChip, cx } from '../../components/ui'

type Res = Record<string, unknown> & { resourceType: string }

function text(code: unknown): string {
  const c = code as { text?: string; coding?: { display?: string; code?: string }[] } | undefined
  return c?.text ?? c?.coding?.[0]?.display ?? c?.coding?.[0]?.code ?? 'Unnamed'
}
function quantity(v: unknown): { value: string; unit: string } | null {
  const q = v as { value?: number; unit?: string } | undefined
  if (!q || q.value == null) return null
  const n = q.value
  const digits = Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : 2
  return { value: String(Number(n.toFixed(digits))), unit: q.unit ?? '' }
}
function noteText(r: Res): string {
  const n = r.note as { text?: string }[] | undefined
  return n?.map((x) => x.text).filter(Boolean).join(' ') ?? ''
}
function medName(r: Res): string {
  const m = r.medication as { concept?: unknown } | undefined
  return text(m?.concept ?? r.medicationCodeableConcept)
}

function Group({ title, children, count }: { title: string; children: React.ReactNode; count: number }) {
  return (
    <section className="card" aria-label={title}>
      <div className="flex items-baseline justify-between px-4 pt-3.5">
        <h3 className="text-base">{title}</h3>
        <span className="num text-xs text-muted">{count}</span>
      </div>
      <div className="scroll-x px-1 pb-2 pt-1">{children}</div>
    </section>
  )
}

export function RecordTab({ record }: { record: PatientRecord | null }) {
  const [open, setOpen] = useState(false)
  const bundle: FhirBundle | undefined = record?.fhir
  const parsed = useMemo(() => {
    const res = (bundle?.entry ?? []).map((e) => e.resource as Res)
    return {
      patient: res.find((r) => r.resourceType === 'Patient'),
      labs: res.filter((r) => r.resourceType === 'Observation' && (r.category as { text?: string }[] | undefined)?.[0]?.text === 'laboratory'),
      vitals: res.filter((r) => r.resourceType === 'Observation' && (r.category as { text?: string }[] | undefined)?.[0]?.text === 'vital-signs'),
      other: res.filter((r) => {
        if (r.resourceType !== 'Observation') return false
        const cat = (r.category as { text?: string }[] | undefined)?.[0]?.text
        return cat !== 'laboratory' && cat !== 'vital-signs'
      }),
      conditions: res.filter((r) => r.resourceType === 'Condition'),
      meds: res.filter((r) => r.resourceType === 'MedicationStatement' || r.resourceType === 'MedicationRequest'),
    }
  }, [bundle])
  const json = useMemo(() => (bundle ? JSON.stringify(bundle, null, 2) : ''), [bundle])

  if (!record) return <EmptyState title="Loading the clinical record…" />
  const s = record.summary

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-3xl text-sm text-muted">
          The clinical record the twin was given for this patient, shown as a readable summary of its FHIR R4 bundle. Labs were
          drawn within six months of the CGM recording, so they are context, not a same-day snapshot.
        </p>
        <ProvChip kind="research" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Group title="Laboratory results" count={parsed.labs.length}>
          <table className="tbl">
            <caption className="sr-only">Laboratory results with units</caption>
            <thead>
              <tr>
                <th scope="col">Test</th>
                <th scope="col" className="r">
                  Result
                </th>
                <th scope="col">Unit</th>
              </tr>
            </thead>
            <tbody>
              {parsed.labs.map((r) => {
                const q = quantity(r.valueQuantity)
                return (
                  <tr key={String(r.id)}>
                    <td>{text(r.code)}</td>
                    <td className="num r font-semibold">{q ? q.value : <span className="font-normal italic text-muted">not recorded</span>}</td>
                    <td className="num text-muted">{q?.unit}</td>
                  </tr>
                )
              })}
              {parsed.labs.length === 0 && (
                <tr>
                  <td colSpan={3} className="italic text-muted">
                    No laboratory results in the record.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Group>

        <div className="space-y-4">
          <Group title="Measurements" count={parsed.vitals.length + parsed.other.length}>
            <table className="tbl">
              <caption className="sr-only">Vital signs and other observations</caption>
              <thead>
                <tr>
                  <th scope="col">Measure</th>
                  <th scope="col" className="r">
                    Value
                  </th>
                  <th scope="col">Unit</th>
                </tr>
              </thead>
              <tbody>
                {[...parsed.vitals, ...parsed.other].map((r) => {
                  const q = quantity(r.valueQuantity)
                  const absent = (r.dataAbsentReason as { text?: string } | undefined)?.text
                  return (
                    <tr key={String(r.id)}>
                      <td>{text(r.code)}</td>
                      <td className="num r font-semibold">
                        {q ? q.value : <span className="font-normal italic text-muted">{absent ?? 'not recorded'}</span>}
                      </td>
                      <td className="num text-muted">{q?.unit}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Group>

          <Group title="Conditions" count={parsed.conditions.length}>
            <ul className="px-3 py-1.5 text-sm">
              {parsed.conditions.length === 0 && <li className="italic text-muted">None recorded.</li>}
              {parsed.conditions.map((r) => (
                <li key={String(r.id)} className="flex items-baseline justify-between gap-3 border-b border-line/60 py-1.5 last:border-b-0">
                  <span>{text(r.code)}</span>
                  <span className="text-xs text-muted">{(r.category as { text?: string }[] | undefined)?.[0]?.text}</span>
                </li>
              ))}
            </ul>
            {(s.complications.length > 0 || s.comorbidities.length > 0) && (
              <div className="border-t border-line px-3 py-2 text-xs text-muted">
                {s.complications.length > 0 && (
                  <p>
                    <span className="font-semibold text-ink">Complications:</span> {s.complications.join(', ')}
                  </p>
                )}
                {s.comorbidities.length > 0 && (
                  <p className="mt-1">
                    <span className="font-semibold text-ink">Comorbidities:</span> {s.comorbidities.join(', ')}
                  </p>
                )}
              </div>
            )}
          </Group>

          <Group title="Medications" count={parsed.meds.length}>
            <ul className="px-3 py-1.5 text-sm">
              {parsed.meds.length === 0 && <li className="italic text-muted">No glucose-lowering drug recorded.</li>}
              {parsed.meds.map((r) => (
                <li key={String(r.id)} className="flex items-baseline justify-between gap-3 border-b border-line/60 py-1.5 last:border-b-0">
                  <span>{medName(r)}</span>
                  <span className="text-xs text-muted">{text(r.category)}</span>
                </li>
              ))}
            </ul>
            {s.other_agents_text && s.other_agents_text !== 'none' && (
              <p className="border-t border-line px-3 py-2 text-xs text-muted">
                <span className="font-semibold text-ink">Other agents:</span> {s.other_agents_text}
              </p>
            )}
          </Group>
        </div>
      </div>

      {parsed.labs.some((r) => noteText(r)) && (
        <p className="text-xs text-muted">{noteText(parsed.labs.find((r) => noteText(r))!)}</p>
      )}

      <section className="card" aria-labelledby="fhir-h">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
          aria-expanded={open}
          aria-controls="fhir-json"
          onClick={() => setOpen((o) => !o)}
        >
          <span>
            <span id="fhir-h" className="block text-base font-semibold">
              Raw FHIR R4 bundle
            </span>
            <span className="block text-xs text-muted">
              <span className="num">{bundle?.entry?.length ?? 0}</span> resources · JSON · {open ? 'click to collapse' : 'click to expand'}
            </span>
          </span>
          <ChevronIcon className={cx('shrink-0 transition-transform', open && 'rotate-90')} />
        </button>
        {open && (
          <pre
            id="fhir-json"
            tabIndex={0}
            aria-label="Raw FHIR JSON"
            className="num m-0 max-h-[520px] overflow-auto border-t border-line bg-bg px-4 py-3 text-xs leading-relaxed"
          >
            {json}
          </pre>
        )}
      </section>
    </div>
  )
}
