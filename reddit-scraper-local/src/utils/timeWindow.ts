/**
 * TimeWindow utility for filtering posts by date range
 */
export class TimeWindow {
  static isWithinWindow(date: Date, from: Date, to: Date): boolean {
    const timestamp = date.getTime();
    return timestamp >= from.getTime() && timestamp <= to.getTime();
  }

  static createTimeWindow(days: number): { from: Date; to: Date } {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    from.setHours(0, 0, 0, 0);
    to.setHours(23, 59, 59, 999);
    
    console.log(`[TimeWindow] Created window: ${from.toISOString()} to ${to.toISOString()}`);
    return { from, to };
  }
}
