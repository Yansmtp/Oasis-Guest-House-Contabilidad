import { BadRequestException } from '@nestjs/common';

const HAVANA_TIME_ZONE = 'America/Havana';
const havanaDateTime = new Intl.DateTimeFormat('en-CA', {
  timeZone: HAVANA_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function havanaStartOfDay(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new BadRequestException('Fecha no válida');
    return parsed;
  }

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const target = Date.UTC(year, month - 1, day);
  const calendarCheck = new Date(target);
  if (calendarCheck.getUTCFullYear() !== year || calendarCheck.getUTCMonth() !== month - 1 || calendarCheck.getUTCDate() !== day) {
    throw new BadRequestException('Fecha no válida');
  }

  let instant = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = havanaDateTime.formatToParts(new Date(instant));
    const part = (type: string) => Number(parts.find(item => item.type === type)?.value || 0);
    const localAsUtc = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
    const difference = target - localAsUtc;
    instant += difference;
    if (difference === 0) break;
  }
  return new Date(instant);
}

/** Interpreta YYYY-MM-DD como fecha civil de Cuba; los timestamps conservan su instante exacto. */
export function parseBusinessDate(value?: string, endOfDay = false): Date | undefined {
  if (!value) return undefined;
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) throw new BadRequestException('Fecha no válida');
      return parsed;
    }
    const start = havanaStartOfDay(value);
    if (!endOfDay) return start;
    const nextDay = new Date(`${value}T00:00:00.000Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    return new Date(havanaStartOfDay(nextDay.toISOString().slice(0, 10)).getTime() - 1);
  } catch {
    throw new BadRequestException('Fecha no válida');
  }
}
