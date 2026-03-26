import { ConferenceRoom } from '@/components/conference/ConferenceRoom';

interface PageProps {
  params: { roomId: string };
}

/**
 * /room/[roomId]
 *
 * Server component that simply passes the roomId down to the
 * ConferenceRoom client component. All real work happens client-side.
 */
export default function RoomPage({ params }: PageProps) {
  return (
    <ConferenceRoom
      roomId={params.roomId}
      sessionTitle="Live Session"
    />
  );
}

// Prevent Next.js from trying to statically render this page
export const dynamic = 'force-dynamic';