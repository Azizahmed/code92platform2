import 'server-only';

import {after} from 'next/server';

import {drainNotificationEmailsAction} from '@/lib/actions/notifications';

// Sends the email a mutation just queued once its response is on the wire.
// Firing drainNotificationEmailsAction() from the client instead costs a second
// round trip, and Next serializes server actions: the drain then sits in front
// of the user's next action, or races a navigation that follows this one.
export function drainEmailsAfterResponse(): void {
  after(async () => {
    await drainNotificationEmailsAction();
  });
}
