// Typefaces from the LeaseFlow login design, scoped to the auth card so other pages keep
// their current type. latin-ext covers the š and ž used in Estonian.
import { Inter, Playfair_Display } from 'next/font/google';

export const authBodyFont = Inter({ subsets: ['latin', 'latin-ext'], display: 'swap' });

export const authHeadingFont = Playfair_Display({
  subsets: ['latin', 'latin-ext'],
  weight: '600',
  display: 'swap',
});
