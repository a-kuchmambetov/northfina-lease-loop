import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { AuthForm } from '@/components/auth-form';
import { AuthShell } from '@/components/auth-shell';
import { getT } from '@/i18n/get-t';
import { isLocale } from '@/i18n/locales';
import { getAuth } from '@/server/auth-instance';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/signup'>): Promise<Metadata> {
  const { locale } = await params;
  return isLocale(locale)
    ? { title: `${getT(locale)('auth.signup')} · ${getT(locale)('brand.name')}` }
    : {};
}

export default async function AuthPage({ params }: PageProps<'/[locale]/signup'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const session = await getAuth().api.getSession({
    headers: await headers(),
    query: { disableRefresh: true },
  });
  if (session) redirect(`/${locale}`);
  return (
    <AuthShell locale={locale} mode="signup">
      <AuthForm locale={locale} mode="signup" />
    </AuthShell>
  );
}
