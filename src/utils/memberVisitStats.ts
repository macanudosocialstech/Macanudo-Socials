export function completedMemberVisitHours(sessions: readonly {
  status?: string; checkInType?: string; durationHours?: unknown;
}[]): number {
  const total = sessions.reduce((sum, session) => {
    if (session.status !== 'completed' || session.checkInType === 'daypass') return sum;
    const hours = session.durationHours ?? 0;
    if (typeof hours !== 'number' || !Number.isFinite(hours) || hours < 0) {
      throw new Error('INVALID_VISIT_HOURS');
    }
    return sum + hours;
  }, 0);
  if (!Number.isFinite(total)) throw new Error('INVALID_VISIT_HOURS');
  return total;
}

export function memberVisitRedemptionLimits(hours: number, config: {
  dailyLimit?: number; totalLimit?: number; hourlyLimit?: number;
} | null) {
  if (!Number.isFinite(hours) || hours < 0) throw new Error('INVALID_VISIT_HOURS');
  // Match redemption.ts: 25 additional cigars per completed 50-hour milestone.
  return {
    dailyLimit: config?.dailyLimit || 3,
    totalLimit: (config?.totalLimit || 25) + Math.floor(hours / 50) * 25,
    hourlyLimit: config?.hourlyLimit,
  };
}
