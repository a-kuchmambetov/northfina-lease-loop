'use client';

import { useState } from 'react';
import { formatEuro } from '@/domain/money';
import { getT, type MessageKey } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';
import type { CustomerProfile } from '@/server/features/customers/get-customer-profile';
import { CustomerProfileForm } from './customer-profile-form';

/** The signed-in customer's own profile: read-only details, with an Edit button for the form. */
export function CustomerProfileView({
  locale,
  initial,
}: {
  locale: Locale;
  initial: CustomerProfile;
}) {
  const t = getT(locale);
  const [profile, setProfile] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);

  if (editing) {
    return (
      <CustomerProfileForm
        locale={locale}
        name={profile.name}
        email={profile.email}
        initial={profile}
        onSaved={(next) => {
          setProfile(next);
          setSaved(true);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  const yesNo = (value: boolean | null) => t(value ? 'profile.yes' : 'profile.no');
  const rows: [MessageKey, string | null][] = [
    ['profile.type', t(`profile.${profile.type}`)],
    ['profile.name', profile.name],
    ['profile.email', profile.email],
    ['profile.country', profile.country],
    ['profile.city', profile.city],
    ['profile.birthDate', profile.birthDate],
    [
      'profile.employment',
      profile.employment ? t(`profile.${profile.employment as 'employed'}`) : null,
    ],
    [
      'profile.monthlyIncome',
      profile.monthlyNetIncomeCents === null
        ? null
        : formatEuro(profile.monthlyNetIncomeCents, locale),
    ],
    ['profile.businessId', profile.businessId],
    [
      'profile.annualRevenue',
      profile.annualRevenueCents === null ? null : formatEuro(profile.annualRevenueCents, locale),
    ],
    ['profile.vatRegistered', profile.type === 'consumer' ? null : yesNo(profile.vatRegistered)],
    [
      'profile.applicantCanSign',
      profile.type === 'company' ? yesNo(profile.applicantCanSign) : null,
    ],
    [
      'profile.beneficialOwners',
      profile.type === 'company' && profile.beneficialOwners.length > 0
        ? profile.beneficialOwners.join(', ')
        : null,
    ],
  ];

  return (
    <section className="profile-page" aria-labelledby="profile-heading">
      <h1 id="profile-heading">{t('profile.viewTitle')}</h1>
      {saved && (
        <p role="status" className="profile-saved">
          {t('profile.saved')}
        </p>
      )}
      <dl className="profile-details">
        {rows
          .filter((row): row is [MessageKey, string] => row[1] !== null && row[1] !== '')
          .map(([label, value]) => (
            <div key={label} className="profile-detail">
              <dt>{t(label)}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
      <button
        type="button"
        className="profile-submit"
        onClick={() => {
          setSaved(false);
          setEditing(true);
        }}
      >
        {t('profile.edit')}
      </button>
    </section>
  );
}
