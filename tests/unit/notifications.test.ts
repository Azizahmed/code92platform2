import {describe, expect, it} from 'vitest';

import {NOTIFICATION_TYPES, notificationHref} from '@/lib/notifications';

const base = {channel_id: null, deal_id: null, account_id: null, product_id: null, task_id: null};

describe('notificationHref (mirrored by linkFor in functions/notify-email.ts)', () => {
  it('routes each record kind to its page', () => {
    expect(notificationHref({...base, channel_id: 'c1'})).toBe('/channels/c1');
    expect(notificationHref({...base, deal_id: 'd1', account_id: 'a1', product_id: 'p1'})).toBe('/sales/deals/d1');
    expect(notificationHref({...base, account_id: 'a1'})).toBe('/sales/accounts/a1');
    expect(notificationHref({...base, task_id: 't1', product_id: 'p1'})).toBe('/products/p1#task-t1');
  });

  it('sends General tasks to All tasks, and nothing to a dead link', () => {
    expect(notificationHref({...base, task_id: 't1'})).toBe('/tasks');
    expect(notificationHref(base)).toBeNull();
  });

  it('knows every 0.2 notification type', () => {
    for (const type of [
      'task_due', 'task_overdue', 'deal_assigned', 'deal_due', 'deal_overdue',
      'deal_closed', 'account_assigned', 'account_archived'
    ]) {
      expect(NOTIFICATION_TYPES).toContain(type);
    }
  });
});
