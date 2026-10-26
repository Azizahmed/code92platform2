import {NextResponse} from 'next/server';

import {getMyWorkCounts} from '@/lib/my-work-counts';

// Polled by the navigation badge. A plain GET rather than a server action:
// server actions share one client-side queue with user mutations, so a poll
// would delay them and could land its (non-revalidating) result over a
// mutation's fresh render.
export const dynamic = 'force-dynamic';

export async function GET() {
  const counts = await getMyWorkCounts();
  return NextResponse.json(counts, {headers: {'Cache-Control': 'private, no-store'}});
}
