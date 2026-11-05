import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { AuthForm } from '@/components/auth-form';
import { getT } from '@/i18n/get-t';
import { isLocale } from '@/i18n/locales';
import { getAuth } from '@/server/auth-instance';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/login'>): Promise<Metadata> {
  const { locale } = await params;
  return isLocale(locale)
    ? { title: `${getT(locale)('auth.login')} · ${getT(locale)('brand.name')}` }
    : {};
}

export default async function AuthPage({ params }: PageProps<'/[locale]/login'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const session = await getAuth().api.getSession({
    headers: await headers(),
    query: { disableRefresh: true },
  });
  if (session) redirect(`/${locale}`);
  return <AuthForm locale={locale} mode="login" />;
}
