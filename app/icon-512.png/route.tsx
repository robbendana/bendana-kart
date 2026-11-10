import { ImageResponse } from 'next/og';
import { AppIcon } from '../app-icon';

// A large icon for "Add to Home Screen" on Android and for desktop installs
export const dynamic = 'force-static';

export function GET() {
  return new ImageResponse(<AppIcon size={512} />, { width: 512, height: 512 });
}
