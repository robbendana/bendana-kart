import type { MetadataRoute } from 'next';

// Lets a phone or tablet add Bendana Kart to its home screen and open it full screen.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Bendana Kart',
    short_name: 'Bendana Kart',
    description: 'A family kart racer you can play together from different devices.',
    start_url: '/',
    display: 'fullscreen',
    display_override: ['fullscreen', 'standalone'],
    orientation: 'any',
    background_color: '#2f9bf0',
    theme_color: '#0f172a',
    icons: [
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png', purpose: 'any' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  };
}
