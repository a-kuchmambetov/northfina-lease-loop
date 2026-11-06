// The two LeaseFlow typefaces, loaded once by the root layout. They are exposed as CSS
// variables that globals.css maps onto the theme's font tokens. latin-ext covers the
// š and ž used in Estonian.
import { Inter, Playfair_Display } from 'next/font/google';

export const bodyFont = Inter({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-inter',
});

export const headingFont = Playfair_Display({
  subsets: ['latin', 'latin-ext'],
  weight: '600',
  display: 'swap',
  variable: '--font-playfair',
});
