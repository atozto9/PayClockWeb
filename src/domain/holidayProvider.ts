import { holidayCatalog } from './holidayCatalog'

export function holidayNameForDayKey(dayKey: string): string | null {
  const year = Number(dayKey.slice(0, 4))
  if (!Number.isFinite(year)) {
    return null
  }

  const rawName = holidayCatalog[year]?.[dayKey]
  if (!rawName) {
    return null
  }

  return localizeHolidayName(rawName)
}

export function isHolidayDay(dayKey: string): boolean {
  return holidayNameForDayKey(dayKey) !== null
}

function localizeHolidayName(rawName: string): string {
  if (rawName.includes(';')) {
    return rawName
      .split(';')
      .map((value) => localizeHolidayName(value.trim()))
      .join(' / ')
  }

  const alternativeRest = replacePrefix(rawName, 'Alternative holiday for ')
  if (alternativeRest) {
    return `${localizeHolidayName(alternativeRest)} 대체공휴일`
  }

  switch (rawName) {
    case "New Year's Day":
      return '신정'
    case 'The day preceding Korean New Year':
      return '설날 연휴'
    case 'Korean New Year':
      return '설날'
    case 'The second day of Korean New Year':
      return '설날 연휴'
    case 'Independence Movement Day':
      return '3·1절'
    case "Children's Day":
      return '어린이날'
    case "Buddha's Birthday":
      return '부처님오신날'
    case 'Memorial Day':
      return '현충일'
    case 'Liberation Day':
      return '광복절'
    case 'The day preceding Chuseok':
      return '추석 연휴'
    case 'Chuseok':
      return '추석'
    case 'The second day of Chuseok':
      return '추석 연휴'
    case 'National Foundation Day':
      return '개천절'
    case 'Hangul Day':
      return '한글날'
    case 'Christmas Day':
      return '성탄절'
    default:
      return rawName
  }
}

function replacePrefix(source: string, prefix: string): string | null {
  if (!source.startsWith(prefix)) {
    return null
  }

  return source.slice(prefix.length)
}
