import { describe, expect, it } from 'vitest';
import { completedMemberVisitHours, memberVisitRedemptionLimits } from './memberVisitStats';

describe('Home member visit semantics', () => {
  it('includes legacy completed visits but excludes Day Pass, pending and expired visits', () => {
    expect(completedMemberVisitHours([
      { status: 'completed', durationHours: 12.5 },
      { status: 'completed', checkInType: 'member', durationHours: 37.5 },
      { status: 'completed', checkInType: 'daypass', durationHours: 20 },
      { status: 'pending', durationHours: 99 }, { status: 'expired', durationHours: 2 },
      { status: 'completed' },
    ])).toBe(50);
  });
  it.each([-1, NaN, Infinity, '12'])('rejects invalid completed hours %s', durationHours => {
    expect(() => completedMemberVisitHours([{ status: 'completed', durationHours }])).toThrow('INVALID_VISIT_HOURS');
  });
  it('matches configured and default redemption milestones exactly', () => {
    expect(memberVisitRedemptionLimits(49.99, null)).toEqual({ dailyLimit: 3, totalLimit: 25, hourlyLimit: undefined });
    expect(memberVisitRedemptionLimits(50, { dailyLimit: 4, totalLimit: 30, hourlyLimit: 2 }))
      .toEqual({ dailyLimit: 4, totalLimit: 55, hourlyLimit: 2 });
    expect(memberVisitRedemptionLimits(150, null).totalLimit).toBe(100);
    expect(() => memberVisitRedemptionLimits(NaN, null)).toThrow();
  });
});
