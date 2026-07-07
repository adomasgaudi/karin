import { dateParts } from '../lib/format'

interface DateStampProps {
  value: string | null | undefined
}

export default function DateStamp({ value }: DateStampProps) {
  const parts = dateParts(value)
  if (!parts) return <>{value || ''}</>

  return (
    <span className="whitespace-nowrap">
      {parts.date} {parts.hour}:{parts.minute}
    </span>
  )
}
